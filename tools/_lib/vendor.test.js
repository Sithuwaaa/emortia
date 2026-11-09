/* vendor.test.js - the vendored library is the one we pinned.

     node tools/_lib/vendor.test.js

   A hash written in a comment is a claim. This is the check, so the
   claim cannot drift away from the bytes: db.js names a version and a
   sha256, and the file beside it has to be that file.

   WHAT THIS CATCHES. A vendored dependency has one failure mode an
   imported one does not: it can be edited. By a well-meant tidy-up, by
   a line-ending conversion on a fresh clone, by somebody dropping in a
   newer build without changing the version db.js asks for. Every one of
   those is silent, and the library is the database layer of every tool
   here - so the bytes are pinned, and pinned means checked.

   It also keeps the two halves honest: db.js says 2.119.0, so the file
   must be named 2.119.0, and the <script> it injects must be the file
   that exists. A pin nothing verifies is a comment. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

const DB = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');

/* read the pin out of db.js rather than repeating it here - two copies of
   a hash is the thing this file exists to prevent */
const version = (DB.match(/const LIB_VERSION = '([^']+)'/) || [])[1];
const sha = (DB.match(/sha256 ([0-9a-f]{64})/) || [])[1];
const size = (DB.match(/UMD\s*\n\s*build, ([\d,]+) bytes/) ||
              DB.match(/build, ([\d,]+) bytes/) || [])[1];

is('db.js names a pinned version', !!version, true);
is('and records a sha256',         !!sha, true);

const file = path.join(__dirname, 'vendor', 'supabase-js-' + version + '.js');
is('THE PINNED FILE EXISTS, at the name db.js will ask for',
   fs.existsSync(file), true);

if (fs.existsSync(file)) {
  const buf = fs.readFileSync(file);
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  is('AND ITS BYTES ARE THE ONES RECORDED', got, sha);
  if (size) is('and the size matches too', buf.length, Number(size.replace(/,/g, '')));

  /* it is the library, not an empty file that happens to hash to itself */
  const src = buf.toString('utf8');
  is('it defines the UMD global',    /var supabase=/.test(src), true);
  is('and exposes createClient',     src.indexOf('createClient') > -1, true);

  /* and it really constructs - a build that parses but cannot make a
     client would pass every check above */
  /* URL and fetch come from the host: createClient validates the URL, so a
     context without them throws "Invalid supabaseUrl" and the test would
     be reporting its own empty sandbox rather than the library. */
  const sandbox = { URL, URLSearchParams, fetch, Headers, TextEncoder,
                    TextDecoder, setTimeout, clearTimeout, console,
                    /* realtime-js refuses to construct without one */
                    WebSocket: typeof WebSocket !== 'undefined' ? WebSocket : function(){} };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  try {
    require('vm').runInNewContext(src, sandbox);
    is('the global appears when it runs', typeof sandbox.supabase, 'object');
    is('createClient is a function',      typeof sandbox.supabase.createClient, 'function');
    const c = sandbox.supabase.createClient('https://x.supabase.co', 'sb_publishable_test');
    is('AND IT CONSTRUCTS A USABLE CLIENT',
       !!c && typeof c.from === 'function' && typeof c.channel === 'function', true);
  } catch (e) {
    is('the vendored build runs', 'threw: ' + e.message, 'no throw');
  }
}

/* Nothing should have crept back to the CDN - asked of the CODE, with the
   comments stripped first. db.js documents the old import in prose, on
   purpose, and the first version of this check matched that prose and
   reported a runtime import that does not exist. A guard that cannot tell
   a comment from a call is not checking the property it names. */
const CODE = DB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
is('the comments really were stripped',
   CODE.length < DB.length && CODE.indexOf('UNPINNED RANGE') < 0, true);
is('db.js imports nothing from esm.sh at runtime',
   /import\(\s*['"`]?https:\/\/esm\.sh/.test(CODE), false);
/* There IS one CDN reference in the code now, and it is allowed to be
   there: the fallback, for when the vendored file fails to deploy - which
   happened, and took the data layer of the whole site down for the window
   between the pages going live and Pages publishing the file beside them.
   What must stay true is that it is PINNED and that it is the same build.
   An unpinned range is the thing this whole change existed to remove, and
   it must not come back through the back door. */
{
  const cdns = CODE.match(/https:\/\/[a-z0-9.\-\/@]*(esm\.sh|jsdelivr|unpkg|cdnjs)[^'"`\s]*/g) || [];
  is('esm.sh is gone from the code',
     cdns.some(u => u.indexOf('esm.sh') > -1), false);
  is('exactly one CDN reference remains - the fallback', cdns.length, 1);
  /* The URL is concatenated with LIB_VERSION rather than written out, so
     it is pinned BY CONSTRUCTION - it cannot drift from the vendored file
     even if somebody bumps one and forgets the other. That is the property
     worth asserting, and it is stronger than matching a version in a
     literal, which was what the first draft of this check looked for and
     is why it failed against better code than it expected. */
  is('the fallback URL is built from LIB_VERSION, so it cannot drift',
     /supabase-js@'\s*\+\s*LIB_VERSION\s*\+\s*'\/dist\/umd/.test(CODE), true);
  is('AND NO VERSION RANGE IS WRITTEN ANYWHERE IN THE CODE',
     /@supabase\/supabase-js@(\^|~|\d+['"`/])/.test(CODE), false);
}
is('and loads the library from vendor/',
   /vendor\/supabase-js-/.test(DB), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
