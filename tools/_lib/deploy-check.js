#!/usr/bin/env node
/* deploy-check.js - did every file in this commit actually reach the site?

     node tools/_lib/deploy-check.js            # HEAD, against emortia.com
     node tools/_lib/deploy-check.js de08a2d
     node tools/_lib/deploy-check.js HEAD~2..HEAD
     node tools/_lib/deploy-check.js HEAD http://localhost:8899

   WHY THIS EXISTS. On 8 November a two-file change shipped, and the check
   afterwards was: fetch the page, see the new markup, call it deployed. The
   page was one of the two files, and it was the one that had arrived. db.js
   had not. The page called a function that was not there and the tool said
   "The database library did not load."

   Two separate mistakes, and the second is the nastier one:

     1. ONE FILE WAS CHECKED AND TWO WERE CHANGED. So this checks every
        file the commit touched, from git, not a list anybody types.

     2. THE CHECK USED A CACHE-BUSTING QUERY STRING. `/sw.js?x=1762...`
        came back v112 while `/sw.js` came back v111 - same server, same
        second. A query string is a different cache key, so it asked a
        question no browser ever asks. Checking db.js that way would have
        passed too, and still been wrong.

        So every fetch here goes to the URL THE PAGE ACTUALLY REQUESTS,
        including its ?v= if it has one, read out of the HTML. Nothing is
        ever appended.

   WHAT IT COMPARES. The bytes committed against the bytes served. Not a
   substring, not a version constant - those are proxies, and a proxy
   agrees with you. A file whose served copy differs from the commit is
   reported with both lengths and the first line that differs.

   A MISSED ?v= BUMP FAILS HERE. If db.js changes and no page bumps
   db.js?v=N, the old URL is still what the page asks for, the CDN still
   has it, and the comparison fails - which is the point. The forgotten
   bump stops being a silent four-hour outage and becomes a red line. */

'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const REF  = process.argv[2] || 'HEAD';
const SITE = (process.argv[3] || 'https://emortia.com').replace(/\/+$/, '');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8',
  maxBuffer: 1 << 28 });

/* ---- what the commit touched ---------------------------------------- */
const range = REF.indexOf('..') > -1 ? REF : REF + '~1..' + REF;
const touched = git('diff', '--name-only', '--diff-filter=ACMR', range)
  .split('\n').map(s => s.trim()).filter(Boolean);

/* WHAT THE SITE SERVES, MEASURED RATHER THAN ASSUMED.

   This used to read:

     /(^supabase\/|^docs\/|^\.|\.test\.js$|^README)/

   - tests, SQL, docs and dotfiles were assumed private because of what
   they are for. Four of those five categories are served. Checked against
   the live site on 13 November 2026, every one returning HTTP 200:

     tools/wh24/wh24.test.js        200
     tools/_lib/identifiers.test.js 200
     docs/wh24-decisions.md         200
     supabase/036_wh24.sql          200
     README.md                      200
     .gitattributes                 200
     .github/workflows/backup.yml   404   <- the only one withheld

   GitHub Pages publishes the repository, not a selected subset of it.
   Only .github/ is held back. 96 committed files sat in that blind spot,
   and a commit touching nothing else reported "0 served ... every served
   file in this commit is live" while verifying nothing at all.

   The lesson is narrower than "the regex was wrong": served-ness is a
   property of the host, which can be measured, and it was being inferred
   from the role of the file, which cannot. */
const NOT_SERVED = /^\.github\//;
const serve = touched.filter(f => !NOT_SERVED.test(f));
const skip  = touched.filter(f =>  NOT_SERVED.test(f));

/* ---- the URL a page would actually ask for --------------------------- */
/* A versioned asset is only reachable at its versioned URL, so the check
   has to find the version the same way a browser does.

   THE VERSION IS READ FROM THE SERVED HTML, NOT FROM THE WORKING TREE.
   The first draft of this file read it locally and that reproduced the
   very bug it was written to catch: the working tree said `db.js?v=2`,
   nobody had ever requested that URL, so the CDN had nothing cached for
   it and it came back fresh and green - while `/tools/_lib/db.js`, the
   URL every live page was actually loading, was four hours stale.

   A URL nobody has requested is always fresh. The only URLs worth
   checking are the ones the LIVE pages ask for, so the live pages are
   what gets read. If the HTML carrying a new ?v= has not deployed yet,
   this correctly checks the old URL and correctly calls it stale. */
const pageCache = new Map();
async function fetchText(u) {
  if (pageCache.has(u)) return pageCache.get(u);
  const p = fetch(u, { cache: 'no-store' })
    .then(r => (r.ok ? r.text() : '')).catch(() => '');
  pageCache.set(u, p);
  return p;
}

async function servedUrl(file) {
  const base = '/' + file.split(path.sep).join('/');
  if (!/\.(js|css)$/.test(base)) return { url: base, from: 'path' };

  /* which pages load it - from git, because a page that was deleted
     locally should not be consulted; what they SAY is read from the site */
  const pages = git('ls-files', '*.html').split('\n').filter(Boolean);
  const name = base.replace(/^.*\//, '');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp('(?:src|href)="([^"]*' + esc + '(?:\\?[^"]*)?)"', 'g');

  const seen = new Map();                   /* query -> a page that says it */
  for (const p of pages) {
    const local = (() => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
                           catch (e) { return ''; } })();
    if (!rx.test(local)) { rx.lastIndex = 0; continue; }   /* cheap pre-filter */
    rx.lastIndex = 0;
    const live = await fetchText(SITE + '/' + p.split(path.sep).join('/'));
    if (!live) continue;
    let m;
    while ((m = rx.exec(live))) {
      const q = m[1].indexOf('?');
      const key = q > -1 ? m[1].slice(q) : '';
      if (!seen.has(key)) seen.set(key, p);
    }
    rx.lastIndex = 0;
  }
  if (seen.size > 1) {
    return { url: base, from: 'AMBIGUOUS',
             queries: [...seen].map(([q, p]) => (q || '(none)') + ' in ' + p) };
  }
  if (!seen.size) return { url: base, from: 'no live page loads it' };
  const q = [...seen.keys()][0];
  return { url: base + q, from: q ? 'as the live pages ask for it' : 'path' };
}

/* ---- what the CDN rewrites on the way out ----------------------------
   Cloudflare sits in front of Pages and obfuscates mailto: links in HTML
   as it serves them, so the served bytes legitimately differ from the
   committed bytes on any page with an email address on it. index.html
   and Emortia.html both have one.

   It is UNDONE here rather than ignored. Ignoring "lines that look like
   email protection" would be a hole big enough to hide a real change in;
   the obfuscation is exactly reversible - the first byte of the hex is
   the key and the rest is XORed with it - so the served copy is turned
   back into what was committed and then compared byte for byte. If the
   decode does not reproduce the original, that is a difference and it is
   reported like any other. */
function uncloudflare(html) {
  if (html.indexOf('__cf_email__') < 0 && html.indexOf('/cdn-cgi/l/email-protection') < 0)
    return html;
  const decode = hex => {
    const k = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2)
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
    return out;
  };
  return html
    /* the injected decoder script */
    .replace(/<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[^"]*email-decode\.min\.js"><\/script>/g, '')
    /* <a href="/cdn-cgi/l/email-protection#HEX" ...>…</a> -> mailto: */
    .replace(/href="\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"/g,
             (m, h) => 'href="mailto:' + decode(h) + '"')
    /* the span that replaced the visible address */
    .replace(/<span class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/span>/g,
             (m, h) => decode(h))
    /* a bare address replaced in text, no span */
    .replace(/<a href="\/cdn-cgi\/l\/email-protection" class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/a>/g,
             (m, h) => decode(h));
}

/* ---- run -------------------------------------------------------------- */
(async () => {
  console.log('deploy-check  ' + range + '  ->  ' + SITE);
  console.log(touched.length + ' file(s) in the commit, ' + serve.length + ' served\n');

  /* A RUN THAT CHECKS NOTHING IS A FAILURE, NOT A PASS. Reaching here with
     an empty list means either the range is wrong or every file in it was
     classified away - and on this repository, where Pages serves all but
     .github/, both of those are tool faults rather than clean commits.
     Four separate defects in this tool this week all resolved to green,
     which is what made its output worth less than it looked. Unknown now
     fails. */
  if (!touched.length) {
    console.log('NOTHING IN RANGE - ' + range + ' names no changed files.');
    console.log('If you meant a single commit, the left side of a..b is EXCLUDED;');
    console.log('pass the last already-verified commit there, or just the SHA.');
    process.exit(1);
  }
  if (!serve.length) {
    for (const f of skip) console.log('-          ' + f + '   (not served)');
    console.log('\nNOTHING TO CHECK - every file in this range was classified as not served.');
    console.log('Pages serves everything except .github/, so this is almost certainly wrong.');
    process.exit(1);
  }

  let bad = 0;
  for (const f of serve) {
    const want = git('show', REF.indexOf('..') > -1 ? REF.split('..')[1] + ':' + f
                                                    : REF + ':' + f);
    const u = await servedUrl(f);
    if (u.from === 'AMBIGUOUS') {
      bad++;
      console.log('AMBIGUOUS  ' + f + '\n    pages disagree on its version: ' +
                  JSON.stringify(u.queries));
      continue;
    }
    let got = null, status = 0;
    try {
      const res = await fetch(SITE + u.url, { cache: 'no-store' });
      status = res.status;
      got = await res.text();
    } catch (e) {
      bad++; console.log('UNREACHABLE  ' + u.url + '  ' + e.message); continue;
    }
    if (status !== 200) { bad++; console.log('HTTP ' + status + '  ' + u.url); continue; }

    /* line endings are a checkout detail, not a deploy one */
    /* line endings are a checkout detail; the CDN's email obfuscation is a
       transit detail and is reversed, not waved away */
    const norm = s => uncloudflare(s.split('\r\n').join('\n'));
    if (norm(got) === norm(want)) {
      console.log('ok         ' + u.url + (u.from === 'path' ? '' : '   (' + u.from + ')'));
      continue;
    }
    bad++;
    const a = norm(want).split('\n'), b = norm(got).split('\n');
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    console.log('STALE      ' + u.url +
      '\n    committed ' + norm(want).length + ' bytes, served ' + norm(got).length +
      '\n    first difference at line ' + (i + 1) +
      '\n      committed: ' + String(a[i]).trim().slice(0, 90) +
      '\n      served:    ' + String(b[i]).trim().slice(0, 90));
  }

  for (const f of skip) console.log('-          ' + f + '   (not served)');

  console.log('\n' + (bad ? bad + ' FILE(S) NOT LIVE' : 'every served file in this commit is live'));
  process.exit(bad ? 1 : 0);
})();
