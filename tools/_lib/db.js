/* db.js - the only file that talks to storage.

   Every tool goes through this. Nothing else should call supabase, fetch a
   data.json, or write to IndexedDB, so there is exactly one place to look when
   data goes somewhere unexpected.

   The shape all the lookup tools work in is {cols, rows}: cols is an array of
   the sheet's own headings, rows is an array of arrays in that order. Postgres
   holds each row as jsonb keyed by heading, so the order lives in `datasets`
   and the translation happens here.

   Order of truth:
     server  - what everyone sees
     cache   - IndexedDB, so the page opens offline and paints before the
               network answers
     bundled - data.json in the repository, the floor if there is no session,
               no key, and no cache

   Load returns the cached copy first if there is one, then quietly replaces it
   when the server answers. */
(function(){
  const CFG = window.SUPABASE_CONFIG || {};
  const CACHE_DB = 'emortia_cache', CACHE_STORE = 'ds';
  const CDN = 'https://esm.sh/@supabase/supabase-js@2';

  let clientPromise = null;
  function client(){
    if (!CFG.url || !CFG.anonKey) return Promise.resolve(null);
    if (!clientPromise){
      clientPromise = import(CDN)
        .then(m => m.createClient(CFG.url, CFG.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true }
        }))
        .catch(e => { console.warn('Supabase client unavailable:', e.message); return null; });
    }
    return clientPromise;
  }
  const configured = () => !!(CFG.url && CFG.anonKey);

  /* ---------------------------------------------------------- local cache */
  function idb(){
    return new Promise((res, rej) => {
      const r = indexedDB.open(CACHE_DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(CACHE_STORE)) r.result.createObjectStore(CACHE_STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function cacheGet(k){
    try { const db = await idb();
      return await new Promise(res => { const t = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(k);
        t.onsuccess = () => res(t.result); t.onerror = () => res(null); });
    } catch(e){ return null; }
  }
  async function cacheSet(k, v){
    try { const db = await idb();
      return await new Promise(res => { const t = db.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put(v, k);
        t.onsuccess = () => res(1); t.onerror = () => res(0); });
    } catch(e){ return 0; }
  }

  /* ---------------------------------------------------------------- auth */
  async function session(){
    const c = await client(); if (!c) return null;
    const { data } = await c.auth.getSession();
    return data ? data.session : null;
  }
  async function signIn(email, password){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing from tools/_lib/supabase-config.js.');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.session;
  }
  /* Returns {user, session}. Whether a session comes back depends on the
     project: with email confirmation switched on Supabase hands back a user
     and no session until the link in the email is clicked. The caller has to
     handle both, because only the project owner knows which it is. */
  async function signUp(email, password, meta){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing from tools/_lib/supabase-config.js.');
    const { data, error } = await c.auth.signUp({ email, password, options: { data: meta || {} } });
    if (error) throw new Error(error.message);
    return data;
  }

  /* Signing in by username: the account is keyed by the address, so the name
     has to be turned back into one first. The function on the server returns
     one address for one exact name and nothing else. */
  async function emailForUsername(username){
    const c = await client(); if (!c) return null;
    const { data, error } = await c.rpc('email_for_username', { uname: username });
    if (error) return null;
    return data || null;
  }

  /* Who am I, by name. Asked on the way in so the site can show the name
     somebody chose rather than working one out from their address. */
  async function myProfile(){
    const c = await client(); if (!c) return null;
    const { data, error } = await c.rpc('my_profile');
    if (error || !data || !data.length) return null;
    return data[0];
  }

  async function setUsername(name){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    const { data, error } = await c.from('profiles')
      .update({ username: name }).eq('id', s.user.id).select().single();
    if (error){
      /* the unique index is what actually decides it, so say what it means */
      if (/duplicate|unique/i.test(error.message)) throw new Error('That name is taken.');
      if (/violates check|profiles_username_shape/i.test(error.message))
        throw new Error('A name is 3 to 32 letters, numbers, dots, dashes or underscores.');
      throw new Error(error.message);
    }
    return data;
  }
  async function signOut(){ const c = await client(); if (c) await c.auth.signOut(); }
  async function onAuth(fn){
    const c = await client(); if (!c) return;
    c.auth.onAuthStateChange((_e, s) => fn(s));
  }

  /* ------------------------------------------------------------- reading */
  const TABLE = { site_access: 'sites' };
  const KEYCOL = { site_access: 'site_id' };

  async function fetchRemote(key){
    const c = await client(); if (!c) return null;
    const table = TABLE[key]; if (!table) throw new Error('No table mapped for "' + key + '"');

    const meta = await c.from('datasets').select('cols,row_count,updated_at').eq('key', key).maybeSingle();
    if (meta.error) throw new Error(meta.error.message);
    if (!meta.data) return null;                       // nothing published yet
    const cols = meta.data.cols || [];

    // PostgREST caps a response, so walk it in pages rather than trusting one call
    const PAGE = 1000; let from = 0, out = [];
    for(;;){
      const { data, error } = await c.from(table).select('data').range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    const rows = out.map(o => cols.map(cn => { const v = o.data ? o.data[cn] : ''; return v == null ? '' : String(v); }));
    return { cols, rows, savedAt: (meta.data.updated_at || '').slice(0, 10), source: 'server' };
  }

  /* Hand back the fastest thing available, then upgrade in place.
     onUpdate is called again if the server turns out to have something newer. */
  async function load(key, bundledUrl, onUpdate){
    const cached = await cacheGet(key);
    const refresh = (async () => {
      if (!configured()) return null;
      try {
        const remote = await fetchRemote(key);
        if (remote){ await cacheSet(key, remote); return remote; }
      } catch(e){ console.warn('Supabase read failed, staying on the local copy:', e.message); }
      return null;
    })();

    if (cached){
      refresh.then(r => { if (r && onUpdate && r.savedAt !== cached.savedAt) onUpdate(r); });
      return cached;
    }
    const remote = await refresh;
    if (remote) return remote;

    const res = await fetch(bundledUrl);
    const ds = await res.json();
    return { cols: ds.cols, rows: ds.rows, savedAt: '', source: 'bundled' };
  }

  /* ------------------------------------------------------------- writing */
  /* Replace a dataset wholesale. Chunked, because a few thousand rows in one
     request is megabytes of JSON and PostgREST will refuse it. onConflict on
     the natural key is what makes re-uploading a corrected sheet update the
     rows instead of piling up duplicates. */
  async function publish(key, cols, rows, onProgress){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - the write policies check auth.uid(), so uploads fail without a session.');

    const table = TABLE[key], keyCol = KEYCOL[key];
    const idx = cols.indexOf(cols.find(cn => cn.toLowerCase().replace(/[^a-z]/g,'') === 'siteid') || cols[0]);

    const recs = [...rows.map(r => {
      const o = {}; cols.forEach((cn, i) => { o[cn] = r[i] == null ? '' : String(r[i]); });
      const rec = {}; rec[keyCol] = String(r[idx] || '').trim(); rec.data = o; return rec;
    }).filter(r => r[keyCol])
  .reduce((m, r) => (m.set(r[keyCol], r), m), new Map()).values()];

    const CHUNK = 500;
    for (let i = 0; i < recs.length; i += CHUNK){
      const { error } = await c.from(table).upsert(recs.slice(i, i + CHUNK), { onConflict: keyCol });
      if (error) throw new Error(error.message);
      if (onProgress) onProgress(Math.min(i + CHUNK, recs.length), recs.length);
    }

    const { error: mErr } = await c.from('datasets').upsert(
      { key, cols, row_count: recs.length, updated_at: new Date().toISOString(), updated_by: s.user.id },
      { onConflict: 'key' });
    if (mErr) throw new Error(mErr.message);

    const saved = { cols, rows, savedAt: new Date().toISOString().slice(0, 10), source: 'server' };
    await cacheSet(key, saved);
    return recs.length;
  }

  /* Another device published; refresh without a reload. */
  async function subscribe(key, fn){
    const c = await client(); if (!c) return;
    c.channel('ds-' + key)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'datasets', filter: 'key=eq.' + key },
          () => fn())
      .subscribe();
  }

  /* ------------------------------------------------------------- workbooks
     A whole parsed workbook in one row of `books`. Unlike the lookup datasets
     this is not a table of records - it is many sheets of differing shapes, and
     each dataset carries its own sheet list. Ongoing has eleven sheets, Master
     eight with different names, so nothing here may assume a fixed set. */
  const BOOK_CACHE = k => 'book:' + k;

  async function publishBook(key, book){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - the write policies check auth.uid(), so uploads fail without a session.');

    const savedAt = book.savedAt || new Date().toISOString().slice(0, 10);
    const row = {
      key: key,
      sheets: book.sheets,
      sheet_order: book.order,
      saved_at: savedAt,
      bytes: book.bytes || null,
      updated_at: new Date().toISOString(),
      updated_by: s.user.id
    };
    const { error } = await c.from('books').upsert(row, { onConflict: 'key' });
    if (error) throw new Error(error.message);

    const saved = { sheets: book.sheets, order: book.order, savedAt: savedAt,
                    bytes: book.bytes || null, source: 'server' };
    await cacheSet(BOOK_CACHE(key), saved);
    return saved;
  }

  async function fetchBook(key){
    const c = await client(); if (!c) return null;
    const { data, error } = await c.from('books')
      .select('sheets,sheet_order,saved_at,bytes,updated_at').eq('key', key).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { sheets: data.sheets || {}, order: data.sheet_order || [],
             savedAt: (data.saved_at || data.updated_at || '').slice(0, 10),
             bytes: data.bytes || null, source: 'server' };
  }

  /* Server, then cache, then whatever the caller can bundle. onUpdate fires if
     the server turns out to be newer than the cache that was handed back. */
  async function loadBook(key, bundled, onUpdate){
    const cached = await cacheGet(BOOK_CACHE(key));
    const refresh = (async () => {
      if (!configured()) return null;
      try {
        const remote = await fetchBook(key);
        if (remote){ await cacheSet(BOOK_CACHE(key), remote); return remote; }
      } catch(e){ console.warn('Supabase read failed, staying on the local copy:', e.message); }
      return null;
    })();

    if (cached){
      refresh.then(r => { if (r && onUpdate && r.savedAt !== cached.savedAt) onUpdate(r); });
      return cached;
    }
    const remote = await refresh;
    if (remote) return remote;
    return bundled ? await bundled() : null;
  }

  async function subscribeBook(key, fn){
    const c = await client(); if (!c) return;
    c.channel('bk-' + key)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books', filter: 'key=eq.' + key },
          () => fn())
      .subscribe();
  }

  /* ----------------------------------------------------------------- todos
     Rows rather than a blob, because two devices can be ticking things off at
     the same time and a whole-document write would have one clobber the other.
     Reads are cached so the list is there before the network answers. */
  const TODO_CACHE = 'todos';

  /* Returns {items, error}. A read that fails still hands back the cache so the
     page is usable, but the caller is told why - an empty list and a broken
     connection look identical on screen otherwise, and "nothing pending" is a
     bad way to find out the table was never created. */
  async function listTodos(){
    const cached = async () => (await cacheGet(TODO_CACHE)) || [];
    const c = await client();
    if (!c) return { items: await cached(),
      error: configured() ? 'Could not reach Supabase.'
                          : 'Not syncing - the anon key is missing from tools/_lib/supabase-config.js.' };
    const { data, error } = await c.from('todos')
      .select('id,title,note,due,done,done_at,created_at')
      .order('done', { ascending: true })
      .order('due', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error){
      console.warn('Todo read failed, using the cached list:', error.message);
      const missing = /schema cache|does not exist/i.test(error.message);
      return { items: await cached(),
        error: missing ? 'The todos table does not exist yet - run supabase/004_todos.sql in the SQL Editor.'
                       : error.message };
    }
    await cacheSet(TODO_CACHE, data || []);
    return { items: data || [], error: null };
  }

  async function addTodo(t){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - adding writes to the shared list.');
    const row = { title: t.title, note: t.note || null, due: t.due || null,
                  updated_at: new Date().toISOString(), updated_by: s.user.id };
    const { data, error } = await c.from('todos').insert(row).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  /* Change a job that is already on the list. Only the three things a person
     types - what it is, the note, and when it is due. */
  async function updateTodo(id, t){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - the list is shared.');
    const row = { title: t.title, note: t.note || null, due: t.due || null,
                  updated_at: new Date().toISOString(), updated_by: s.user.id };
    const { data, error } = await c.from('todos').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function setTodoDone(id, done){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - ticking off writes to the shared list.');
    const { error } = await c.from('todos').update({
      done: !!done, done_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(), updated_by: s.user.id
    }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function subscribeTodos(fn){
    const c = await client(); if (!c) return;
    c.channel('todos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => fn())
      .subscribe();
  }

  /* ------------------------------------------------------------------ ESN

     One table and one private storage bucket. The tool never speaks to either
     directly - this is the only file that does, so there is one place to look
     when a screenshot goes missing. */
  const ESN = 'esn_records', BUCKET = 'esn';

  async function esnList(limit){
    const c = await client(); if (!c) return { rows: [], error: 'offline' };
    const { data, error } = await c.from(ESN).select('*')
      .order('created_at', { ascending: false }).limit(limit || 500);
    if (error) return { rows: [], error: error.message };
    return { rows: data || [], error: null };
  }

  /* Images go to storage under the site they belong to, named by when they
     arrived, so two people filing the same site never overwrite each other. */
  async function esnUpload(siteId, kind, blob, ext){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    const safe = String(siteId || 'unknown').toUpperCase().replace(/[^A-Z0-9_-]+/g, '') || 'UNKNOWN';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = safe + '/' + stamp + '-' + kind + '.' + (ext || 'webp');
    const { error } = await c.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/webp', upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }

  /* The bucket is private, so a path is not a URL. These are short-lived links
     asked for at the moment something is shown or exported. */
  async function esnLink(path, seconds){
    const c = await client(); if (!c || !path) return null;
    const { data, error } = await c.storage.from(BUCKET)
      .createSignedUrl(path, seconds || 3600);
    return error ? null : (data ? data.signedUrl : null);
  }

  async function esnSave(rec){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    const row = {
      site_id: rec.siteId, site_name: rec.siteName || null,
      run_om: !!rec.runOm,
      esn_photo: rec.esnPhoto || null, esn_full: rec.esnFull || null,
      om_ip_photo: rec.omIpPhoto || null,
      cards: rec.cards || [], note: rec.note || null,
      umpt_password: rec.umptPassword || null,
      created_by: s.user.id, created_email: s.user.email || null
    };
    const q = rec.id
      ? c.from(ESN).update(row).eq('id', rec.id).select().single()
      : c.from(ESN).insert(row).select().single();
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  }

  /* The row and its pictures go together. The pictures first: a row deleted
     with its images left behind is storage nobody can find again, and nobody
     would ever notice. If the images refuse, the row stays too, so the record
     still points at them and it can be tried again. */
  async function esnDelete(id, paths){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const keep = (paths || []).filter(Boolean);
    if (keep.length){
      const { error: se } = await c.storage.from(BUCKET).remove(keep);
      if (se) throw new Error(se.message);
    }
    const { error } = await c.from(ESN).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function esnSubscribe(fn){
    const c = await client(); if (!c) return;
    c.channel('esn_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: ESN }, () => fn())
      .subscribe();
  }

  /* ---------------------------------------------------- lyric video projects

     Timing a song word by word is an hour that used to live in one browser.
     These keep it on the server instead, saved as a draft while the work is
     still going, so an unfinished song survives a cleared cache or a move to
     another machine. */
  const LYRIC = 'lyric_projects', LBUCKET = 'lyric';
  /* past this the browser is holding the whole file in memory to send it, and
     a WAV is not worth that - the name is remembered instead */
  const LYRIC_MAX = 60 * 1024 * 1024;

  async function lyricList(limit){
    const c = await client(); if (!c) return { rows: [], error: 'offline' };
    const { data, error } = await c.from(LYRIC).select('*')
      .order('updated_at', { ascending: false }).limit(limit || 100);
    if (error) return { rows: [], error: error.message };
    return { rows: data || [], error: null };
  }

  async function lyricGet(id){
    const c = await client(); if (!c) return null;
    const { data, error } = await c.from(LYRIC).select('*').eq('id', id).single();
    return error ? null : data;
  }

  /* Files are filed under the owner's uid because the storage policies read
     that first path segment - it is what stops one account reaching another's
     artwork by guessing. */
  async function lyricUpload(kind, blob, name){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    if (blob.size > LYRIC_MAX) return null;      // caller falls back to the name
    const ext = (String(name || '').match(/\.([a-z0-9]{1,5})$/i) || [, 'bin'])[1].toLowerCase();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = s.user.id + '/' + stamp + '-' + kind + '.' + ext;
    const { error } = await c.storage.from(LBUCKET).upload(path, blob, {
      contentType: blob.type || 'application/octet-stream', upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }

  async function lyricLink(path, seconds){
    const c = await client(); if (!c || !path) return null;
    const { data, error } = await c.storage.from(LBUCKET)
      .createSignedUrl(path, seconds || 7200);
    return error ? null : (data ? data.signedUrl : null);
  }

  /* Saving the same project again updates it rather than piling up copies -
     which is what lets this be called on a timer while the work goes on. */
  async function lyricSave(p){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    const row = {
      name: p.name || 'Untitled',
      status: p.status === 'done' ? 'done' : 'draft',
      lyrics: p.lyrics || '',
      settings: p.settings || {},
      art_path: p.artPath || null,
      audio_path: p.audioPath || null,
      track_pick: p.trackPick == null ? null : String(p.trackPick),
      audio_name: p.audioName || null,
      created_by: s.user.id
    };
    const q = p.id
      ? c.from(LYRIC).update(row).eq('id', p.id).select().single()
      : c.from(LYRIC).insert(row).select().single();
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  }

  /* The files go with the row, for the same reason as the ESN images: a row
     deleted with its art left behind is storage nobody can find again. */
  async function lyricDelete(id, paths){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const keep = (paths || []).filter(Boolean);
    if (keep.length) await c.storage.from(LBUCKET).remove(keep);
    const { error } = await c.from(LYRIC).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /* ------------------------------------------------------- design sheets

     A design book used to live in whichever browser it was dropped into.
     These put it on the server, and - the part that matters - write only the
     sites that actually differ from what is already there. A vendor resending
     the same book with one azimuth moved should touch one row, not 245. */
  const DSITES = 'design_sites', DBATCH = 'design_batches';

  /* What the server already holds for a scope: {SITEID: fingerprint}. Asked
     for on its own so the diff can be worked out before anything is written,
     and so the whole payload does not have to come down to do it. */
  async function designFingerprints(scope){
    const c = await client(); if (!c) return {};
    const out = {};
    const PAGE = 1000;
    for (let from = 0;; from += PAGE){
      const { data, error } = await c.from(DSITES)
        .select('site_id,fingerprint').eq('scope', scope).range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      (data || []).forEach(r => { out[r.site_id] = r.fingerprint; });
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async function designLoad(scope){
    const c = await client(); if (!c) return { sites: [], error: 'offline' };
    const out = [];
    const PAGE = 500;
    for (let from = 0;; from += PAGE){
      const { data, error } = await c.from(DSITES)
        .select('site_id,data,fingerprint,project,batch,first_seen,updated_at')
        .eq('scope', scope).order('site_id').range(from, from + PAGE - 1);
      if (error) return { sites: [], error: error.message };
      (data || []).forEach(r => out.push(Object.assign({}, r.data, {
        siteId: r.site_id, _fingerprint: r.fingerprint, _project: r.project,
        _batch: r.batch, _firstSeen: r.first_seen, _updatedAt: r.updated_at })));
      if (!data || data.length < PAGE) break;
    }
    return { sites: out, error: null };
  }

  /* Writes the plan a caller worked out with DesignSync. Only plan.write is
     sent; everything the book listed and did not change is left untouched,
     and everything the book never mentioned is left alone entirely - a batch
     file covers its own batch and must not wipe the ones around it. */
  async function designPublish(scope, plan, meta, onProgress){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session();
    if (!s) throw new Error('Sign in first - the write policies check auth.uid().');

    const rows = (plan.write || []).map(w => ({
      scope, site_id: w.siteId, data: w.site, fingerprint: w.fingerprint,
      project: w.project || null,
      batch: (meta && meta.file) || null,
      updated_at: new Date().toISOString(), updated_by: s.user.id
    }));

    const CHUNK = 250;
    for (let i = 0; i < rows.length; i += CHUNK){
      const { error } = await c.from(DSITES)
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'scope,site_id' });
      if (error) throw new Error(error.message);
      if (onProgress) onProgress(Math.min(i + CHUNK, rows.length), rows.length);
    }

    /* the line in the log, written even when nothing moved - "we looked and
       nothing had changed" is worth being able to see later */
    const cnt = plan.counts || {};
    const { error: bErr } = await c.from(DBATCH).insert({
      scope, file_name: (meta && meta.file) || null,
      sites: cnt.total || 0, added: cnt.added || 0,
      changed: cnt.changed || 0, unchanged: cnt.unchanged || 0,
      changed_ids: (plan.changed || []).map(x => x.siteId).slice(0, 500),
      uploaded_by: s.user.id, uploaded_name: (meta && meta.who) || null
    });
    if (bErr) throw new Error(bErr.message);
    return rows.length;
  }

  async function designBatches(limit){
    const c = await client(); if (!c) return { rows: [], error: 'offline' };
    const { data, error } = await c.from(DBATCH).select('*')
      .order('uploaded_at', { ascending: false }).limit(limit || 40);
    if (error) return { rows: [], error: error.message };
    return { rows: data || [], error: null };
  }

  async function designSubscribe(fn){
    const c = await client(); if (!c) return;
    c.channel('design_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: DSITES }, () => fn())
      .subscribe();
  }

  /* ------------------------------------------------------- feature locks

     Three tools and the journal belong to the owner, and now and then one has
     to be opened for somebody else. Locked is the default everywhere: a
     feature with no row is owner-only, and a read that fails leaves
     everything shut rather than open. */
  async function featureLocks(){
    const c = await client(); if (!c) return {};
    const { data, error } = await c.from('feature_locks').select('feature,unlocked,note,updated_at');
    if (error) return {};
    const out = {};
    (data || []).forEach(r => { out[r.feature] = { unlocked: !!r.unlocked, note: r.note || '',
                                                   at: r.updated_at }; });
    return out;
  }

  async function setFeatureLock(feature, unlocked, note){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    const { error } = await c.from('feature_locks').upsert(
      { feature, unlocked: !!unlocked, note: note || null,
        updated_at: new Date().toISOString(), updated_by: s.user.id },
      { onConflict: 'feature' });
    /* the policy is the real lock; if it refuses, say so plainly */
    if (error) throw new Error(/row-level security|permission/i.test(error.message)
      ? 'Only the owner can change these.' : error.message);
  }

  async function onFeatureLocks(fn){
    const c = await client(); if (!c) return;
    c.channel('locks_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feature_locks' }, () => fn())
      .subscribe();
  }

  /* ---------------------------------------------------- the team directory

     Ninety-seven people with their mobiles and NIC numbers. It lives here and
     nowhere else - see the note at the top of supabase/012_team.sql for why
     it is not a file in the repository like the site lookups are.

     Reading needs an account. Writing is the owner's, enforced by the policy
     rather than by which buttons the page draws. */
  const TGROUPS = 'team_groups', TPEOPLE = 'team_people', TVEHICLES = 'team_vehicles';

  /* One shape out: teams in their order, each carrying its own people and
     vehicles. Three queries rather than a join, because supabase's embedded
     selects need a foreign-key hint and three round trips in parallel cost
     less than getting that wrong. */
  async function teamLoad(){
    const c = await client(); if (!c) return { teams: [], error: 'offline' };
    const [g, p, v] = await Promise.all([
      c.from(TGROUPS).select('*').order('sort', { ascending: true }),
      c.from(TPEOPLE).select('*').order('sort', { ascending: true }),
      c.from(TVEHICLES).select('*').order('sort', { ascending: true })
    ]);
    /* Nothing on screen should name a table or a schema cache. Before the
       migration is run this said "Could not find the table 'public.team_groups'
       in the schema cache", which tells whoever is reading it nothing they can
       act on - and tells everybody else the shape of the database. */
    const bad = g.error || p.error || v.error;
    if (bad) return { teams: [], error:
      /does not exist|schema cache|could not find the table/i.test(bad.message)
        ? 'The directory is not switched on yet. Sithara has one step left to do.'
      : /jwt|not authenticated|row-level security|permission/i.test(bad.message)
        ? 'Your sign-in has run out. Reload the page and sign in again.'
      : /fetch|network|failed to|timeout/i.test(bad.message)
        ? 'No connection just now. Try again in a moment.'
      : bad.message };

    const teams = (g.data || []).map(r => ({
      id: r.id, team: r.team, source: r.source || 'other', sort: r.sort || 0,
      people: [], vehicles: []
    }));
    const by = {};
    teams.forEach(t => { by[t.id] = t; });
    /* a row whose team has gone is dropped rather than thrown - the cascade
       should have taken it, and a directory that will not load because of one
       orphan is worse than a directory missing one line */
    (p.data || []).forEach(r => { if (by[r.team_id]) by[r.team_id].people.push({
      id: r.id, name: r.name || '', mobile: r.mobile || '', nic: r.nic || '',
      company: r.company || '', role: r.role || '' }); });
    (v.data || []).forEach(r => { if (by[r.team_id]) by[r.team_id].vehicles.push({
      id: r.id, reg: r.reg || '', kind: r.kind || '', driver: r.driver || '' }); });
    return { teams, error: null };
  }

  /* Nothing on screen should name a table or a policy. "Only the owner can
     change these" is the whole of what somebody needs to know. */
  function teamErr(e){
    const m = String((e && e.message) || e || '');
    if (/row-level security|permission|policy/i.test(m)) throw new Error('Only Sithara can change the directory.');
    if (/duplicate|unique/i.test(m)) throw new Error('There is already a team with that name.');
    if (/jwt|not authenticated/i.test(m)) throw new Error('Your sign-in has run out. Reload and sign in again.');
    throw new Error(m || 'That did not save.');
  }
  async function tc(){ const c = await client(); if (!c) throw new Error('Not connected just now.'); return c; }

  /* sort is "one past the last", so a new row lands at the bottom of the list
     it was added to rather than in the middle of somebody else's ordering */
  const nextSort = list => (list || []).length;

  async function teamAddGroup(id, name, sort){
    const c = await tc();
    const { error } = await c.from(TGROUPS).insert(
      { id, team: name, source: 'custom', sort: sort || 0 });
    if (error) teamErr(error);
  }
  async function teamRenameGroup(id, name){
    const c = await tc();
    const { error } = await c.from(TGROUPS).update({ team: name }).eq('id', id);
    if (error) teamErr(error);
  }
  /* the people and the vehicles go with it - that is the cascade in 012, not
     three deletes from here that could half-finish */
  async function teamDeleteGroup(id){
    const c = await tc();
    const { error } = await c.from(TGROUPS).delete().eq('id', id);
    if (error) teamErr(error);
  }

  async function teamSavePerson(p){
    const c = await tc();
    const row = { team_id: p.teamId, name: p.name, mobile: p.mobile || null,
                  nic: p.nic || null, company: p.company || null, role: p.role || null };
    const { error } = p.id
      ? await c.from(TPEOPLE).update(row).eq('id', p.id)
      : await c.from(TPEOPLE).insert(Object.assign({ sort: p.sort || 0 }, row));
    if (error) teamErr(error);
  }
  async function teamDeletePerson(id){
    const c = await tc();
    const { error } = await c.from(TPEOPLE).delete().eq('id', id);
    if (error) teamErr(error);
  }

  async function teamSaveVehicle(v){
    const c = await tc();
    const row = { team_id: v.teamId, reg: v.reg, kind: v.kind || null, driver: v.driver || null };
    const { error } = v.id
      ? await c.from(TVEHICLES).update(row).eq('id', v.id)
      : await c.from(TVEHICLES).insert(Object.assign({ sort: v.sort || 0 }, row));
    if (error) teamErr(error);
  }
  async function teamDeleteVehicle(id){
    const c = await tc();
    const { error } = await c.from(TVEHICLES).delete().eq('id', id);
    if (error) teamErr(error);
  }

  /* An upload writes only what the plan says moved. Inserts go in one call
     each for people and vehicles; updates go one at a time because each
     targets its own row. Nothing here deletes - the plan never asks it to. */
  async function teamApplyImport(plan){
    const c = await tc();
    const done = { teams:0, add:0, update:0, addV:0, updateV:0 };

    if ((plan.newTeams || []).length){
      const { error } = await c.from(TGROUPS).insert(plan.newTeams.map((t, i) => ({
        id: t.id, team: t.team, source: 'sheet', sort: 1000 + i })));
      if (error) teamErr(error);
      done.teams = plan.newTeams.length;
    }
    if ((plan.add || []).length){
      const { error } = await c.from(TPEOPLE).insert(plan.add.map(p => ({
        team_id: p.teamId, name: p.name, mobile: p.mobile || null, nic: p.nic || null,
        company: p.company || null, role: p.role || null, sort: p.sort || 0 })));
      if (error) teamErr(error);
      done.add = plan.add.length;
    }
    for (const p of (plan.update || [])){
      const { error } = await c.from(TPEOPLE).update({
        name: p.name, mobile: p.mobile || null, nic: p.nic || null,
        company: p.company || null, role: p.role || null }).eq('id', p.id);
      if (error) teamErr(error);
      done.update++;
    }
    if ((plan.addV || []).length){
      const { error } = await c.from(TVEHICLES).insert(plan.addV.map(v => ({
        team_id: v.teamId, reg: v.reg, kind: v.kind || null,
        driver: v.driver || null, sort: v.sort || 0 })));
      if (error) teamErr(error);
      done.addV = plan.addV.length;
    }
    for (const v of (plan.updateV || [])){
      const { error } = await c.from(TVEHICLES).update({
        reg: v.reg, kind: v.kind || null, driver: v.driver || null }).eq('id', v.id);
      if (error) teamErr(error);
      done.updateV++;
    }
    return done;
  }

  /* ---------------------------------------------------- the delete gate

     A salt and a PBKDF2 hash of the password that has to be typed before
     anything is removed. See the note at the top of
     supabase/014_team_delete_gate.sql: this guards the owner against their
     own hand, not the directory against other people. */
  async function gateGet(id){
    const c = await client(); if (!c) return null;
    const { data, error } = await c.from('owner_gate').select('salt,hash,iter')
      .eq('id', id || 'team-delete').maybeSingle();
    if (error) return null;                      // no table yet reads as "not set"
    return data || null;
  }
  async function gateSet(id, rec){
    const c = await tc();
    const { error } = await c.from('owner_gate').upsert(
      { id: id || 'team-delete', salt: rec.salt, hash: rec.hash, iter: rec.iter },
      { onConflict: 'id' });
    if (error) throw new Error(/row-level security|permission/i.test(error.message)
      ? 'Only Sithara can set that.'
      : /does not exist|schema cache/i.test(error.message)
      ? 'The delete gate is not switched on yet - migration 014 has not been run.'
      : error.message);
  }

  async function teamSubscribe(fn){
    const c = await client(); if (!c) return;
    const ch = c.channel('team_live');
    [TGROUPS, TPEOPLE, TVEHICLES].forEach(t =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => fn()));
    ch.subscribe();
  }

  /* ------------------------------------------------- the field reference

     Vendor commands, logins and the UMPT passwords. One row holding one JSON
     document - see the note at the top of supabase/013_field_config.sql for
     why none of it is a file in this repository. */
  async function fieldConfigLoad(){
    const c = await client(); if (!c) return { doc: null, error: 'offline' };
    const { data, error } = await c.from('field_config').select('doc,updated_at')
      .eq('id', 'main').maybeSingle();
    if (error) return { doc: null, error:
      /does not exist|schema cache|could not find the table/i.test(error.message)
        ? 'The reference is not switched on yet. Sithara has one step left to do.'
      : /jwt|not authenticated|row-level security|permission/i.test(error.message)
        ? 'Your sign-in has run out. Reload the page and sign in again.'
      : /fetch|network|failed to|timeout/i.test(error.message)
        ? 'No connection just now. Try again in a moment.'
      : error.message };
    /* no row at all is not a failure - it is an empty reference waiting to be
       seeded, and it should read as empty rather than as broken */
    return { doc: data ? (data.doc || []) : [], at: data ? data.updated_at : null, error: null };
  }

  async function fieldConfigSave(doc){
    const c = await client(); if (!c) throw new Error('Not connected just now.');
    const { error } = await c.from('field_config')
      .upsert({ id: 'main', doc }, { onConflict: 'id' });
    if (error) throw new Error(/row-level security|permission/i.test(error.message)
      ? 'Only Sithara can change the reference.' : error.message);
  }

  async function fieldConfigSubscribe(fn){
    const c = await client(); if (!c) return;
    c.channel('field_config_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'field_config' }, () => fn())
      .subscribe();
  }

  window.DB = { configured, client, session, signIn, signUp, signOut, onAuth, emailForUsername, myProfile, setUsername,
                fieldConfigLoad, fieldConfigSave, fieldConfigSubscribe,
                featureLocks, setFeatureLock, onFeatureLocks,
                teamLoad, teamAddGroup, teamRenameGroup, teamDeleteGroup,
                teamSavePerson, teamDeletePerson, teamSaveVehicle, teamDeleteVehicle,
                teamSubscribe, teamNextSort: nextSort, teamApplyImport,
                gateGet, gateSet,
                designFingerprints, designLoad, designPublish, designBatches, designSubscribe,
                esnList, esnSave, esnDelete, esnUpload, esnLink, esnSubscribe,
                lyricList, lyricGet, lyricSave, lyricDelete, lyricUpload, lyricLink, LYRIC_MAX,
                load, publish, subscribe,
                publishBook, loadBook, subscribeBook,
                listTodos, addTodo, updateTodo, setTodoDone, subscribeTodos,
                cacheSet, cacheGet };
})();
