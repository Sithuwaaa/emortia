/* fixture.js - stand-in rows, so a page can be LOOKED AT where there is no
   anon key and no session.

   WHY THIS EXISTS. The Claude Design copy of this site deliberately has no
   anon key in tools/_lib/supabase-config.js - the key stays out of it, and
   that is correct. The cost was that every preview of a tool rendered the
   same sentence, "Supabase is not configured", instead of the page somebody
   wanted to look at. Reviewing a layout against an error message is not
   reviewing it.

   THE SWITCH IS THE ABSENCE OF THE KEY, which is what makes this safe. It is
   not a flag somebody has to remember to turn off, and not a query string
   anyone could add:

     1. there must be no anonKey, and
     2. the host must not be the live site.

   On emortia.com the key is present, so (1) already fails; the host check is
   the second lock, for the day a deploy goes out with the key missing. In
   that case the live site must show its real error - a site quietly serving
   invented material codes is far worse than one saying it cannot connect.
   Both locks have to fail open for the fixture to appear, and it says so on
   screen when it does.

   WHAT IT STANDS IN FOR. Only the reads a page needs to draw itself. Nothing
   here writes, and the write paths are replaced with refusals rather than
   left pointing at a client that does not exist - a preview must not be able
   to pretend it deleted anything.

   THE ROWS ARE INVENTED. No real material code, description or vendor: this
   repository is public, and the Dialog material master is not ours to
   publish. The shape is what materials.js collates - { code, desc, type,
   vendor, attrs } - and the types are the real TYPE_META keys only so the
   families, labels and facets have something true to group by.
   tools/_lib/mkfixture.js builds the same shape for the node tests; this is
   that idea moved into the page so a preview gets it too. */
(function () {
  'use strict';

  var cfg = window.SUPABASE_CONFIG || {};
  var keyless = !String(cfg.anonKey || '').trim();
  var host = String(location.hostname || '').toLowerCase();
  var live = host === 'emortia.com' || /\.emortia\.com$/.test(host);

  window.FIXTURE = { on: false, why: '', rows: null };

  if (!keyless) { window.FIXTURE.why = 'an anon key is configured'; return; }
  if (live)     { window.FIXTURE.why = 'this is the live host'; return; }

  window.FIXTURE.on = true;
  window.FIXTURE.why = 'no anon key, and "' + (host || 'no host') +
                       '" is not the live site';

  /* ---------------------------------------------------------- the rows */
  var TYPES = ['Antenna', 'Radio', 'Jumpers', 'CenRF IBS', 'Com & Filters',
               'AAU & AIR', 'IBS', 'GPS', 'BB,MPT,EXT,BB accs', 'BBU',
               'Fibers', 'IP', 'TX', 'H & E SFP', 'PWR', 'RRU PWR', 'Civil'];
  /* Four the table maps and two it does not, because the real sheets are
     the same mix - and a fixture that only carried mappable spellings
     could not show that an unmapped one now keeps its own name. */
  var VENDORS = ['Huawei', 'Ericsson', 'Nokia', 'ZTE', 'Fibrolan', 'HUA'];
  var BANDS = ['900MHz', '1.8GHz', '2.1GHz', '2.6GHz'];

  function build() {
    var rows = [], i;
    for (i = 0; i < 96; i++) {
      var type = TYPES[i % TYPES.length];
      var attrs = {
        Vendor: VENDORS[i % VENDORS.length],
        Model: 'SAMPLE-' + (100 + (i % 9)),
        Band: BANDS[i % BANDS.length]
      };
      if (i % 5 === 0) attrs['Macro/Lamp'] = (i % 10 === 0) ? 'Macro' : 'Lamp';
      /* roughly one in seven, so the Disposed segment and the chips both
         have something to show without the list looking like a graveyard */
      if (i % 7 === 0) attrs['Total Dispose'] = 'Dispose';
      rows.push({
        code: 'SAMPLE-' + String(1000 + i),
        desc: 'Sample ' + type + ' row ' + (i + 1) + ' - invented, not a real material',
        type: type,
        /* through the real normaliser, not straight across, so the preview
           shows what collate() would actually put on the row */
        vendor: (window.MAT && window.MAT.normVendor) ? window.MAT.normVendor(attrs.Vendor) : attrs.Vendor,
        attrs: attrs
      });
    }
    return rows;
  }
  /* BUILT ON FIRST READ, NOT NOW. materials.js loads after this file, so
     window.MAT does not exist yet and normVendor could not be used at all
     if the rows were made here - the preview would show the raw spelling
     where the real page shows the normalised one. */
  var ROWS = null;
  function rows(){ if (!ROWS){ ROWS = build(); window.FIXTURE.rows = ROWS; } return ROWS; }

  /* ------------------------------------------------- the gate, and reads

     Access.protect is replaced rather than satisfied. Satisfying it would
     mean inventing a session, and a fake session is the one thing that must
     not exist in a file the live site also loads. */
  window.Access = window.Access || {};
  window.Access.protect = function () {};
  window.Access.signOut = window.Access.signOut || function () {};
  window.IS_OWNER = false;          /* a preview owns nothing */

  var stamp = '2026-01-01T00:00:00.000000+00:00';
  var DB = window.DB = window.DB || {};
  var refuse = function (what) {
    return function () {
      return Promise.reject(new Error('This is a preview with sample data - ' +
        what + ' needs the real site.'));
    };
  };

  DB.configured      = function () { return false; };
  DB.session         = function () { return Promise.resolve(null); };
  DB.materialsLoad   = function () {
    return Promise.resolve({ rows: rows().slice(), stamp: stamp, n: rows().length, error: null });
  };
  DB.materialsCount  = function () { return Promise.resolve({ n: rows().length, error: null }); };
  DB.materialsSubscribe = function () { return Promise.resolve({ unsubscribe: function () {} }); };
  DB.materialsSave   = refuse('uploading');
  DB.materialsWipe   = refuse('emptying the list');

  /* -------------------------------------------------------- say so, loudly
     Stand-in rows that are not labelled are worse than no rows: somebody
     screenshots one and it becomes a figure. */
  function banner() {
    if (document.getElementById('fixture-note')) return;
    var b = document.createElement('div');
    b.id = 'fixture-note';
    b.textContent = 'Preview · sample data, no database connected';
    b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);' +
      'z-index:2147482000;padding:7px 14px;border-radius:999px;font:600 12px/1.4 ' +
      "'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
      'background:#1d2e1c;color:#e7f3e5;border:1px solid #81d67b;' +
      'box-shadow:0 10px 24px rgba(0,0,0,.45);pointer-events:none';
    document.body.appendChild(b);
  }
  if (document.body) banner();
  else document.addEventListener('DOMContentLoaded', banner);

  try { console.info('[fixture] on - ' + window.FIXTURE.why); } catch (e) {}
})();
