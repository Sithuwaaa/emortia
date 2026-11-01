/* store.js - the only thing in the Excel browser that knows where a
   project is kept.

   Year Goals went from localStorage to a Postgres table without a single
   call site changing, because every read and write in that tool went
   through goals/store.js. This is the same boundary for the same reason,
   written before it is needed rather than after.

   EVERY FUNCTION IS ASYNC, including the ones that are instant against
   IndexedDB. A caller written against a synchronous store is a caller
   that breaks the day the store becomes a network. Awaiting something
   instant costs a microtask; not awaiting something slow costs a rewrite.

   ---------------------------------------------------------------- SHAPE

   A PROJECT is the card on the list:
     { id, name, client, created, updated, n_files, n_sheets, n_rows, pct }

   A REPORT is one sheet of one uploaded workbook, WITHOUT its data:
     { id, project_id, file, sheet, uploaded, n_rows, n_cols,
       kind, pct, items, short }

   A PAYLOAD is that sheet's data, fetched on its own:
     { cols: [...], rows: [[...]] }

   The split is the whole design. Measured on four real workbooks before
   any of this was written:

     every sheet of every project     776 kB   -   88 kB on the wire
     one card on the project list     165 B    -  141 B on the wire
     the biggest single sheet         141 kB   - 10.2 kB on the wire

   325x. And it widens every month, because the tool keeps every upload as
   history and the cards never do. wh24Load said select('*') once and it
   cost a gigabyte in a day; projects are bigger than tickets.

   ------------------------------------------------------- WHAT IS LAZY

   list()            projects only. Never touches a payload.
   reports(id)       one project's sheets, metadata only. Never a payload.
   sites(id)         the harvest the MOD panel needs. Still not a payload.
   payload(repId)    ONE sheet. The only function here that fetches data.

   payload() is the lazy fetch. Nothing calls it until a sheet is opened,
   and tools/project-update/lazy.test.js asserts that - it watches what
   the client was ASKED for, not what came back, because a fake that
   returns rows it was not asked for would hide exactly this.

   ---------------------------------------------------------- HISTORY

   Every upload is kept. `latest()` picks the newest row per file+sheet and
   is what every view uses; older rows are reachable only through
   previousOf(), which looks one version back for the "+3 done since"
   line. NOTHING IN THE TOOL READS FURTHER BACK THAN ONE VERSION, so
   everything older is storage with no reader - which is fine while it is
   megabytes a year, and is the fact that matters on the day KEEP_VERSIONS
   below stops being Infinity.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PUStore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* HOW MANY VERSIONS OF A SHEET TO KEEP.

     Infinity means keep everything, which is where this ships. The sweep
     is written and tested below and does not run; flipping this to 2
     turns it on.

     Keeping is reversible and deleting is not: prune to two versions and
     then want August's, and August is gone. At the measured rate - 8
     projects, monthly re-uploads - all of history is about 12 MB a year
     against a 500 MB database, so there is no pressure to decide early.

     What makes it safe to flip later: nothing reads past one version
     back. See the HISTORY note above. */
  var KEEP_VERSIONS = Infinity;

  var DB_NAME = 'emortia_project_update', STORE = 'projects';

  /* ------------------------------------------------------------ local
     The offline fallback, and what the tool ran on before there was a
     table. Kept deliberately: a warehouse counter with no signal still
     opens the tool. */
  var local = (function () {
    var p;
    function open() {
      return p || (p = new Promise(function (res, rej) {
        var r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      }));
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE));
          t.oncomplete = function () { res(out && out.result); };
          t.onerror = function () { rej(t.error); };
        });
      });
    }
    return {
      all: function () { return tx('readonly', function (s) { return s.getAll(); }); },
      put: function (v) { return tx('readwrite', function (s) { return s.put(v); }); },
      del: function (id) { return tx('readwrite', function (s) { return s.delete(id); }); }
    };
  })();

  /* A locally stored project is the old whole-thing record:
       { id, name, client, created, updated, reports: [ {..., cols, rows} ] }
     Remote splits that into a row and N report rows. These two translate,
     so the rest of the tool sees one shape whichever backend is live. */
  function cardOf(p) {
    var reports = p.reports || [];
    var latest = latestOf(reports);
    return {
      id: p.id, name: p.name, client: p.client || '',
      created: p.created, updated: p.updated || p.created,
      n_files: uniq(reports.map(function (r) { return r.file; })).length,
      n_sheets: latest.length,
      n_rows: latest.reduce(function (a, r) { return a + (r.rows ? r.rows.length : r.n_rows || 0); }, 0),
      pct: p.pct == null ? null : p.pct
    };
  }
  function metaOf(r, projectId) {
    return { id: r.id, project_id: projectId, file: r.file, sheet: r.sheet,
             uploaded: r.uploaded, n_rows: r.rows ? r.rows.length : (r.n_rows || 0),
             n_cols: r.cols ? r.cols.length : (r.n_cols || 0),
             kind: r.kind || 'list', pct: r.pct == null ? null : r.pct,
             n_done: r.n_done == null ? null : r.n_done,
             items: r.items == null ? null : r.items,
             short: r.short == null ? null : r.short };
  }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

  /* the newest row per file+sheet, which is what every view shows */
  function latestOf(reports) {
    var m = {};
    (reports || []).forEach(function (r) {
      var k = (r.file + '|' + r.sheet).toLowerCase();
      if (!m[k] || m[k].uploaded < r.uploaded) m[k] = r;
    });
    return Object.keys(m).map(function (k) { return m[k]; });
  }
  /* one version back, which is as far as anything reads */
  function previousOf(reports, r) {
    return (reports || []).filter(function (x) {
      return x.id !== r.id && x.file === r.file &&
             x.sheet.toLowerCase() === r.sheet.toLowerCase() && x.uploaded < r.uploaded;
    }).sort(function (a, b) { return b.uploaded - a.uploaded; })[0] || null;
  }

  /* ---- which backend ------------------------------------------------- */
  var mode = 'local';
  function use(m) { mode = m === 'remote' ? 'remote' : 'local'; }
  function syncing() { return mode === 'remote'; }
  function remoteReady() {
    return mode === 'remote' && typeof window !== 'undefined' &&
           window.DB && typeof window.DB.puProjects === 'function';
  }

  /* ---- reads ---------------------------------------------------------- */

  /* THE LIST. Cards only. This function must never cause a payload to be
     fetched, locally or remotely, and lazy.test.js fails if it does. */
  function list() {
    if (!remoteReady()) {
      return local.all().then(function (rows) {
        return (rows || []).map(cardOf)
          .sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
      }).catch(function () { return []; });
    }
    return window.DB.puProjects().then(function (r) {
      if (r.error) throw new Error(r.error);
      return (r.rows || []).map(function (row) {
        return { id: row.id, name: row.name, client: row.client || '',
                 created: +new Date(row.created_at), updated: +new Date(row.updated_at),
                 n_files: row.n_files, n_sheets: row.n_sheets,
                 n_rows: row.n_rows, pct: row.pct };
      });
    });
  }

  /* one project's sheets, metadata only */
  function reports(projectId) {
    if (!remoteReady()) {
      return local.all().then(function (rows) {
        var p = (rows || []).filter(function (x) { return x.id === projectId; })[0];
        return p ? (p.reports || []).map(function (r) { return metaOf(r, projectId); }) : [];
      }).catch(function () { return []; });
    }
    return window.DB.puReports(projectId).then(function (r) {
      if (r.error) throw new Error(r.error);
      return (r.rows || []).map(function (row) {
        return { id: row.id, project_id: row.project_id, file: row.file, sheet: row.sheet,
                 uploaded: +new Date(row.uploaded), n_rows: row.n_rows, n_cols: row.n_cols,
                 kind: row.kind, pct: row.pct, n_done: row.n_done,
                 items: row.items, short: row.short };
      });
    });
  }

  /* THE LAZY FETCH. One sheet's data, and the only thing here that moves
     a payload. */
  function payload(reportId) {
    if (!remoteReady()) {
      return local.all().then(function (rows) {
        for (var i = 0; i < (rows || []).length; i++) {
          var hit = (rows[i].reports || []).filter(function (r) { return r.id === reportId; })[0];
          if (hit) return { cols: hit.cols || [], rows: hit.rows || [] };
        }
        return null;
      }).catch(function () { return null; });
    }
    return window.DB.puPayload(reportId).then(function (r) {
      if (r.error) throw new Error(r.error);
      return r.payload || null;
    });
  }

  /* the MOD panel's site harvest, which is not a payload and not a card */
  function sites(projectId) {
    if (!remoteReady()) {
      return local.all().then(function (rows) {
        var p = (rows || []).filter(function (x) { return x.id === projectId; })[0];
        return (p && p.sites) || null;
      }).catch(function () { return null; });
    }
    return window.DB.puSites(projectId).then(function (r) {
      if (r.error) throw new Error(r.error);
      return r.sites || null;
    });
  }

  /* ---- writes --------------------------------------------------------- */
  function saveProject(p) {
    if (!remoteReady()) {
      return local.all().then(function (rows) {
        var cur = (rows || []).filter(function (x) { return x.id === p.id; })[0] || { reports: [] };
        return local.put({ id: p.id, name: p.name, client: p.client || '',
          created: p.created || Date.now(), updated: Date.now(),
          pct: p.pct == null ? null : p.pct, sites: p.sites || cur.sites || {},
          reports: cur.reports || [] });
      }).then(function () { return true; }).catch(function () { return false; });
    }
    return window.DB.puSaveProject({
      id: p.id, name: p.name, client: p.client, created_at: p.created_at,
      n_files: p.n_files, n_sheets: p.n_sheets, n_rows: p.n_rows,
      pct: p.pct, sites: p.sites
    }).then(function () { return true; });
  }

  function saveReport(r) {
    if (!remoteReady()) {
      return local.all().then(function (rows) {
        var p = (rows || []).filter(function (x) { return x.id === r.project_id; })[0];
        if (!p) return false;
        p.reports = (p.reports || []).filter(function (x) { return x.id !== r.id; });
        p.reports.push({ id: r.id, file: r.file, sheet: r.sheet, uploaded: r.uploaded,
          kind: r.kind, pct: r.pct, n_done: r.n_done, items: r.items, short: r.short,
          cols: (r.payload && r.payload.cols) || [], rows: (r.payload && r.payload.rows) || [] });
        p.updated = Date.now();
        return local.put(p).then(function () { return true; });
      }).catch(function () { return false; });
    }
    return window.DB.puSaveReport(r).then(function () { return true; });
  }

  function removeProject(id) {
    if (!remoteReady()) return local.del(id).then(function () { return true; })
      .catch(function () { return false; });
    return window.DB.puDeleteProject(id).then(function () { return true; });
  }

  /* Removing sheets - a whole file's worth, or one. This exists because
     the tool was calling window.DB.puDeleteReports directly for a while,
     which is a hole straight through the boundary this file is: the one
     thing nothing outside here is supposed to do is know that a database
     is involved. merge.test.js caught it. */
  function removeReports(ids) {
    var keep = (ids || []).filter(Boolean);
    if (!keep.length) return Promise.resolve(true);
    if (!remoteReady()) {
      return local.all().then(function (rows) {
        var touched = [];
        (rows || []).forEach(function (p) {
          var before = (p.reports || []).length;
          p.reports = (p.reports || []).filter(function (r) { return keep.indexOf(r.id) < 0; });
          if (p.reports.length !== before) { p.updated = Date.now(); touched.push(p); }
        });
        return Promise.all(touched.map(function (p) { return local.put(p); }));
      }).then(function () { return true; }).catch(function () { return false; });
    }
    return window.DB.puDeleteReports(keep).then(function () { return true; });
  }

  /* ---- the prune, written and not running ----------------------------
     Returns the report ids that KEEP_VERSIONS would discard. With the
     constant at Infinity it returns an empty list every time, which is
     what makes it safe to call from anywhere while the switch is off. */
  function stale(reportMetas) {
    if (!isFinite(KEEP_VERSIONS)) return [];
    var byKey = {};
    (reportMetas || []).forEach(function (r) {
      var k = (r.file + '|' + r.sheet).toLowerCase();
      (byKey[k] = byKey[k] || []).push(r);
    });
    var out = [];
    Object.keys(byKey).forEach(function (k) {
      byKey[k].sort(function (a, b) { return b.uploaded - a.uploaded; })
        .slice(KEEP_VERSIONS).forEach(function (r) { out.push(r.id); });
    });
    return out;
  }

  /* The sweep itself. Never called by the tool while KEEP_VERSIONS is
     Infinity, because stale() hands it nothing. */
  function sweep(projectId) {
    return reports(projectId).then(function (metas) {
      var gone = stale(metas);
      if (!gone.length) return { removed: 0, ids: [] };
      if (!remoteReady()) return { removed: 0, ids: [] };
      return window.DB.puDeleteReports(gone)
        .then(function () { return { removed: gone.length, ids: gone }; });
    });
  }

  /* ---- step 3: the subscription ---------------------------------------
     pu_projects only. A pu_reports row carries the payload, and an
     oversized realtime payload is dropped without telling the client -
     a subscription that silently stops delivering is worse than none.

     Four reasons this fires, and only one of them is an event: a real
     postgres_changes hit, becoming visible again, the 15 minute backstop,
     and the channel coming back. liveChannel hands the reason in, and it
     is passed through, because a reload that reconciled nothing must not
     claim somebody else changed something. */
  function watch(onChange) {
    if (!remoteReady() || typeof window.DB.puSubscribe !== 'function') return function () {};
    var off = null, stopped = false;
    window.DB.puSubscribe(function (why) {
      if (stopped) return;
      onChange({ why: why, real: why === undefined });
    }).then(function (teardown) {
      if (stopped && typeof teardown === 'function') teardown();
      else off = teardown;
    });
    return function () {
      stopped = true;
      if (typeof off === 'function') { try { off(); } catch (e) {} off = null; }
    };
  }

  return {
    use: use, syncing: syncing,
    list: list, reports: reports, payload: payload, sites: sites,
    saveProject: saveProject, saveReport: saveReport, removeProject: removeProject,
    removeReports: removeReports,
    latestOf: latestOf, previousOf: previousOf, cardOf: cardOf, metaOf: metaOf,
    stale: stale, sweep: sweep, watch: watch,
    KEEP_VERSIONS: KEEP_VERSIONS
  };
}));
