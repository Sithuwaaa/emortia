/* fake-supabase.js - a Supabase client that can be told to fail.

   db.js is a hundred and twenty-three functions that every tool on this site
   reads and writes through, and it had no test of any kind. The reason it had
   none is that testing it means standing a database up, and the reason that
   matters is that the interesting behaviour is not the happy path. It is what
   happens when the write does not land: whether the record is kept, whether a
   retry files it twice, whether a half-finished upload leaves rubbish behind.

   None of that is reachable against a real server, because a real server
   cannot be asked to fail on the third call and succeed on the fourth. So:

     const db = Fake.client({ esn_records: [] });
     db.__fail({ times: 1, message: 'network' });   // the next call throws
     db.__timeout({ times: 1 });                    // the next call never lands
     db.__partial({ after: 2 });                    // two uploads, then failure

   Everything written is in db.__store, so a test can ask what actually landed
   rather than trusting the return value.

   It is deliberately not a Postgres. It understands the operators db.js
   actually uses and nothing else, and it throws on anything it does not
   recognise rather than quietly returning the wrong rows - a fake that
   silently ignores a filter is worse than no fake at all.
*/
(function (root, make) {
  const F = make();
  if (typeof module === 'object' && module.exports) module.exports = F;
  else root.Fake = F;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

  /* A Supabase error is not thrown; it comes back in the envelope. Tests care
     about the difference, because db.js handles the two differently. */
  const ok  = data => ({ data: clone(data), error: null });
  const bad = message => ({ data: null, error: { message: String(message) } });

  function match(row, filters) {
    return filters.every(f => {
      const v = row[f.col];
      switch (f.op) {
        case 'eq':  return v === f.val;
        case 'neq': return v !== f.val;
        case 'gt':  return v >   f.val;
        case 'gte': return v >=  f.val;
        case 'lt':  return v <   f.val;
        case 'lte': return v <=  f.val;
        case 'in':  return (f.val || []).indexOf(v) > -1;
        case 'is':  return v === f.val;
        case 'contains':
          return Array.isArray(v) && (f.val || []).every(x => v.indexOf(x) > -1);
        default: throw new Error('the fake does not know the operator "' + f.op + '"');
      }
    });
  }

  function client(seed, opts) {
    const store = {};
    Object.keys(seed || {}).forEach(k => { store[k] = clone(seed[k]) || []; });
    const files = {};                 // bucket -> path -> { size, type, writes }
    const calls = [];                 // every call, in order, for assertions
    const o = opts || {};

    /* How the next call (or calls) should misbehave. One counter for each
       kind, so a test can stack "fail twice then succeed". */
    let failN = 0, failMsg = 'network error', failThrow = false;
    let timeoutN = 0;
    let partialAfter = -1, partialDone = 0;

    function budget(what) {
      calls.push(what);
      if (timeoutN > 0) {
        timeoutN--;
        /* A timeout is not an error. It is a promise that never settles, and
           the difference matters: code that only catches rejections hangs
           here, which is exactly what it would do in the field. */
        return { kind: 'timeout' };
      }
      if (partialAfter >= 0) {
        if (partialDone >= partialAfter) { return { kind: 'fail', message: 'the connection dropped' }; }
        partialDone++;
      }
      if (failN > 0) { failN--; return { kind: 'fail', message: failMsg, thrown: failThrow }; }
      return { kind: 'ok' };
    }

    const stall = () => new Promise(() => {});

    function query(table) {
      if (!store[table]) store[table] = [];
      const st = { table, filters: [], order: null, limit: null, range: null,
                   cols: '*', op: null, rows: null, wants: null };

      const api = {};
      const self = () => api;

      api.select = (cols) => { st.cols = cols || '*'; if (!st.op) st.op = 'select'; return self(); };
      ['eq','neq','gt','gte','lt','lte','in','is','contains'].forEach(op => {
        api[op] = (col, val) => { st.filters.push({ col, op, val }); return self(); };
      });
      api.match = (obj) => { Object.keys(obj).forEach(c =>
        st.filters.push({ col: c, op: 'eq', val: obj[c] })); return self(); };
      api.order = (col, o2) => { st.order = { col, asc: !(o2 && o2.ascending === false) }; return self(); };
      api.limit = (n) => { st.limit = n; return self(); };
      api.range = (a, b) => { st.range = [a, b]; return self(); };
      api.single = () => { st.wants = 'single'; return self(); };
      api.maybeSingle = () => { st.wants = 'maybe'; return self(); };

      api.insert = (rows) => { st.op = 'insert'; st.rows = [].concat(rows); return self(); };
      api.update = (patch) => { st.op = 'update'; st.rows = [patch]; return self(); };
      api.upsert = (rows, cfg) => { st.op = 'upsert'; st.rows = [].concat(rows);
        st.onConflict = (cfg && cfg.onConflict) || 'id'; return self(); };
      api.delete = () => { st.op = 'delete'; return self(); };

      function run() {
        const b = budget({ table, op: st.op || 'select', filters: st.filters.slice() });
        if (b.kind === 'timeout') return stall();
        if (b.kind === 'fail') {
          if (b.thrown) return Promise.reject(new Error(b.message));
          return Promise.resolve(bad(b.message));
        }

        const rows = store[table];
        let out;
        if (st.op === 'insert' || st.op === 'upsert') {
          const keys = String(st.onConflict || 'id').split(',').map(s => s.trim());
          out = st.rows.map(r => {
            const row = clone(r);
            if (st.op === 'upsert') {
              const at = rows.findIndex(x => keys.every(k => x[k] === row[k]));
              if (at > -1) { rows[at] = Object.assign({}, rows[at], row); return clone(rows[at]); }
            } else if (row.id != null && rows.some(x => x.id === row.id)) {
              /* what a real unique violation looks like coming back */
              return { __dup: true };
            }
            rows.push(row); return clone(row);
          });
          const dup = out.find(r => r && r.__dup);
          if (dup) return Promise.resolve(bad(
            'duplicate key value violates unique constraint "' + table + '_pkey"'));
        } else if (st.op === 'update') {
          out = [];
          rows.forEach((r, i) => {
            if (!match(r, st.filters)) return;
            rows[i] = Object.assign({}, r, clone(st.rows[0]));
            out.push(clone(rows[i]));
          });
        } else if (st.op === 'delete') {
          out = [];
          for (let i = rows.length - 1; i >= 0; i--) {
            if (match(rows[i], st.filters)) out.push(clone(rows.splice(i, 1)[0]));
          }
        } else {
          out = rows.filter(r => match(r, st.filters)).map(clone);
          if (st.order){
            const c = st.order.col;
            out.sort((a, b2) => (String(a[c]) < String(b2[c]) ? -1 : String(a[c]) > String(b2[c]) ? 1 : 0));
            if (!st.order.asc) out.reverse();
          }
          if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
          if (st.limit != null) out = out.slice(0, st.limit);
        }

        if (st.wants === 'single'){
          if (out.length !== 1) return Promise.resolve(bad(
            'JSON object requested, multiple (or no) rows returned'));
          return Promise.resolve(ok(out[0]));
        }
        if (st.wants === 'maybe') return Promise.resolve(ok(out[0] || null));
        return Promise.resolve(ok(out));
      }

      /* Awaiting the builder is what runs it, the same as the real one. */
      api.then = (res, rej) => run().then(res, rej);
      api.catch = (rej) => run().catch(rej);
      return api;
    }

    const storage = {
      from(bucket) {
        if (!files[bucket]) files[bucket] = {};
        return {
          async upload(path, blob, cfg) {
            const b = budget({ bucket, op: 'upload', path });
            if (b.kind === 'timeout') return stall();
            if (b.kind === 'fail') return bad(b.message);
            const had = files[bucket][path];
            if (had && !(cfg && cfg.upsert))
              return bad('The resource already exists');
            files[bucket][path] = {
              size: (blob && blob.size) || 0,
              type: (blob && blob.type) || (cfg && cfg.contentType) || '',
              writes: (had ? had.writes : 0) + 1
            };
            return ok({ path });
          },
          async remove(paths) {
            const b = budget({ bucket, op: 'remove', paths });
            if (b.kind === 'timeout') return stall();
            if (b.kind === 'fail') return bad(b.message);
            [].concat(paths).forEach(p => { delete files[bucket][p]; });
            return ok([]);
          },
          async createSignedUrl(path, secs) {
            const b = budget({ bucket, op: 'sign', path });
            if (b.kind === 'timeout') return stall();
            if (b.kind === 'fail') return bad(b.message);
            if (!files[bucket][path]) return bad('Object not found');
            return ok({ signedUrl: 'https://fake/' + bucket + '/' + path + '?t=' + (secs || 60) });
          }
        };
      }
    };

    const user = o.user || { id: 'u-test', email: 'sithuwaaathepage@gmail.com' };
    const auth = {
      async getSession(){ return ok({ session: o.signedOut ? null : { user } }); },
      onAuthStateChange(){ return { data: { subscription: { unsubscribe(){} } } }; },
      async signInWithPassword(){ return ok({ user }); },
      async signUp(){ return ok({ user }); },
      async signOut(){ return ok(null); }
    };

    async function rpc(name, args) {
      const b = budget({ op: 'rpc', name, args });
      if (b.kind === 'timeout') return stall();
      if (b.kind === 'fail') return bad(b.message);
      const fn = (o.rpc || {})[name];
      if (!fn) return bad('function ' + name + ' does not exist');
      try { return ok(await fn(args, store, files)); }
      catch (e){ return bad(e.message); }
    }

    return {
      from: query, storage, auth, rpc,
      /* ---- the handles a test pulls ---- */
      __store: store,
      __files: files,
      __calls: calls,
      __fail(cfg){ cfg = cfg || {}; failN = cfg.times == null ? 1 : cfg.times;
        failMsg = cfg.message || 'network error'; failThrow = !!cfg.thrown; return this; },
      __timeout(cfg){ timeoutN = (cfg && cfg.times) == null ? 1 : cfg.times; return this; },
      __partial(cfg){ partialAfter = (cfg && cfg.after) == null ? 1 : cfg.after;
        partialDone = 0; return this; },
      __settle(){ failN = 0; timeoutN = 0; partialAfter = -1; return this; },
      __uploads(bucket){ return Object.keys(files[bucket] || {}).sort(); },
      __writes(bucket, path){ return ((files[bucket] || {})[path] || {}).writes || 0; }
    };
  }

  return { client, ok, bad };
}));
