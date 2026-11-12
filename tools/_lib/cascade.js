/* cascade.js - which declaration actually wins.

   WHY THIS EXISTS. family.test.js enforced the accent pin by reading a
   tool's own index.html, access.js, category.css and theme.css. It never
   opened a _lib stylesheet, so any shared sheet loaded after category.css
   could override the family unseen and the suite stayed green. That was
   recorded as a blind spot on 11 November and bit on 12 November: a design
   bundle reinstated the accent block with !important inside
   leaf-glass.css, and nothing in 2,816 assertions noticed.

   The fix cannot be another grep. A grep asks "does this file say the
   wrong thing", and the answer that matters is "what does the page end up
   with" - which depends on load order, specificity and !important across
   every sheet a page pulls in, wherever they live.

   WHY NOT A REAL BROWSER. The suite is plain `node file.js`, no
   dependencies, runs offline. Adding a headless browser for one guard
   would make it unrunnable where it runs today. And nothing here needs
   layout or paint: a custom property's winner is a pure function of the
   stylesheets and the element's attributes.

   So this resolves the cascade directly. It is deliberately small and
   refuses rather than guesses: anything it cannot parse confidently is
   reported, not silently skipped, because a resolver that quietly drops
   a rule would recreate the exact hole it was written to close.

   IT IS CHECKED AGAINST A REAL BROWSER. cascade.test.js carries known
   answers taken from getComputedStyle on the rendered pages, both themes.
   If this file ever disagrees with Chrome, that test fails. */

const fs = require('fs');
const path = require('path');

class CascadeRefusal extends Error {}

/* ---- 1. the sheets a page loads, in the order it loads them --------- */

/* Inline <style> counts, and its position matters: on Material Codes the
   page's own 90KB <style> sits AFTER the leaf-glass link, so a declaration
   there beats one of equal specificity in the stylesheet. Reading the links
   alone would get the order wrong in the one direction that hides an
   override. */
function sheetsFor(pageFile) {
  const html = fs.readFileSync(pageFile, 'utf8');
  const dir = path.dirname(pageFile);
  const out = [];
  const rx = /<link\b[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = rx.exec(html))) {
    const tag = m[0];
    if (tag.toLowerCase().startsWith('<style')) {
      out.push({ name: path.basename(pageFile) + ' <style> @' + m.index, css: m[1] });
      continue;
    }
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    if (/^https?:|^\/\//i.test(href)) { out.push({ name: href, css: '', external: true }); continue; }
    const file = path.join(dir, href.split('?')[0]);
    if (!fs.existsSync(file)) throw new CascadeRefusal('page links a stylesheet that is not there: ' + href);
    out.push({ name: path.relative(path.dirname(path.dirname(dir)), file).split(path.sep).join('/'),
               css: fs.readFileSync(file, 'utf8') });
  }
  return out;
}

/* ---- 2. rules out of CSS ------------------------------------------- */

const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* At-rules are not flattened. A declaration inside @media is reported on
   the rule, so a caller can refuse to answer rather than quietly ignore an
   override that only applies in print or at a breakpoint. */
function rules(css, sheetName) {
  const s = strip(css);
  const out = [];
  let i = 0, order = 0;
  const atStack = [];
  while (i < s.length) {
    const brace = s.indexOf('{', i);
    if (brace < 0) break;
    const head = s.slice(i, brace).trim();
    if (head.startsWith('@')) {
      const name = head.split(/[\s({]/)[0].toLowerCase();
      if (name === '@media' || name === '@supports' || name === '@layer') {
        atStack.push({ head, end: matchBrace(s, brace) });
        i = brace + 1;
        continue;
      }
      i = matchBrace(s, brace) + 1;            // @font-face, @keyframes: no cascade here
      continue;
    }
    const end = matchBrace(s, brace);
    if (end < 0) throw new CascadeRefusal('unbalanced braces in ' + sheetName);
    const body = s.slice(brace + 1, end);
    while (atStack.length && brace > atStack[atStack.length - 1].end) atStack.pop();
    const at = atStack.filter(a => brace < a.end).map(a => a.head);
    out.push({ sheet: sheetName, order: order++, at,
               selectors: splitTop(head, ','), decls: decls(body) });
    i = end + 1;
  }
  return out;
}
function matchBrace(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') d++;
    else if (s[i] === '}') { d--; if (!d) return i; }
  }
  return -1;
}
/* split on a character that is not inside () or [] or quotes */
function splitTop(s, ch) {
  const out = []; let cur = '', depth = 0, q = null;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ch && !depth) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function decls(body) {
  const out = [];
  for (const part of splitTop(body, ';')) {
    const c = part.indexOf(':');
    if (c < 0) continue;
    const prop = part.slice(0, c).trim();
    let value = part.slice(c + 1).trim();
    if (!prop || prop.endsWith('{')) continue;
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    out.push({ prop, value, important });
  }
  return out;
}

/* ---- 3. does this selector match this element? ---------------------- */

/* An element is described, not built: { tag, attrs, classes }. The chain is
   ancestors first, target last. Only what these pages actually use is
   supported - tag, .class, [attr], [attr="v"], :not(...), descendant and
   child. Anything else refuses. */
const COMBINATOR = /\s*([>+~])\s*|\s+/;

function parseCompound(sel) {
  const parts = [];
  const rx = /(^|(?<=\)))(?:\*|[a-zA-Z][\w-]*)|\.[\w-]+|#[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\(([^)]*)\))?/g;
  let m, consumed = 0;
  while ((m = rx.exec(sel))) {
    parts.push(m[0]);
    consumed += m[0].length;
  }
  if (consumed !== sel.length) throw new CascadeRefusal('selector part not understood: ' + sel);
  return parts;
}
function matchPart(part, el) {
  if (part === '*') return true;
  if (/^[a-zA-Z]/.test(part)) return el.tag === part.toLowerCase();
  if (part.startsWith('.')) return (el.classes || []).includes(part.slice(1));
  if (part.startsWith('#')) return el.id === part.slice(1);
  if (part.startsWith('[')) {
    const body = part.slice(1, -1);
    const eq = body.indexOf('=');
    if (eq < 0) return Object.prototype.hasOwnProperty.call(el.attrs || {}, body.trim());
    const name = body.slice(0, eq).trim();
    const want = body.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    return (el.attrs || {})[name] === want;
  }
  if (part.startsWith(':not(')) {
    const inner = part.slice(5, -1);
    return !splitTop(inner, ',').some(s => matchCompound(s, el));
  }
  /* :root behaves as html here; these pages never put custom properties on
     anything else that :root could mean. */
  if (part === ':root') return el.tag === 'html';
  if (part.startsWith('::')) return false;              // a pseudo-element is not this element
  if (/^:(hover|focus|active|focus-visible|disabled|checked|first-child|last-child|nth-child)/.test(part))
    return el.state === true ? true : false;            // state selectors: only when asked for
  throw new CascadeRefusal('pseudo not understood: ' + part);
}
function matchCompound(sel, el) {
  return parseCompound(sel.trim()).every(p => matchPart(p, el));
}
/* right-to-left over the chain */
function matchSelector(sel, chain) {
  const toks = [];
  let rest = sel.trim(), guard = 0;
  while (rest.length) {
    if (guard++ > 50) throw new CascadeRefusal('selector too long: ' + sel);
    const m = rest.match(/\s*([>+~])\s*|\s+/);
    if (!m) { toks.push({ comb: null, sel: rest }); break; }
    const at = rest.indexOf(m[0]);
    toks.push({ comb: null, sel: rest.slice(0, at) });
    toks.push({ comb: (m[1] || ' ') });
    rest = rest.slice(at + m[0].length);
  }
  const seq = toks.filter(t => t.sel !== undefined || t.comb);
  /* walk from the right */
  let ci = chain.length - 1;
  let i = seq.length - 1;
  if (!seq.length) return false;
  if (!matchCompound(seq[i].sel, chain[ci])) return false;
  i--;
  while (i >= 0) {
    const comb = seq[i].comb; i--;
    if (i < 0) return false;
    const want = seq[i].sel; i--;
    if (comb === ' ') {
      let found = false;
      while (--ci >= 0) { if (matchCompound(want, chain[ci])) { found = true; break; } }
      if (!found) return false;
    } else if (comb === '>') {
      if (--ci < 0 || !matchCompound(want, chain[ci])) return false;
    } else {
      throw new CascadeRefusal('combinator not supported here: ' + comb);
    }
  }
  return true;
}

/* ---- 4. specificity ------------------------------------------------- */
function specificity(sel) {
  let a = 0, b = 0, c = 0;
  for (const piece of sel.split(/\s*[>+~]\s*|\s+/).filter(Boolean)) {
    for (const p of parseCompound(piece)) {
      if (p.startsWith('#')) a++;
      else if (p.startsWith('.') || p.startsWith('[')) b++;
      else if (p.startsWith(':not(')) {
        const inner = p.slice(5, -1);
        const s = specificity(inner);
        a += s[0]; b += s[1]; c += s[2];
      } else if (p.startsWith('::')) c++;
      else if (p.startsWith(':')) b++;
      else if (p !== '*') c++;
    }
  }
  return [a, b, c];
}
const cmpSpec = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/* ---- 5. the winner --------------------------------------------------- */

/* Returns the declaration that wins for `prop` on the element at the end of
   `chain`, or null if nothing sets it. Throws if a candidate lives inside an
   at-rule, because this does not evaluate media conditions and must not
   pretend the answer is complete. */
function winner(sheets, chain, prop, opts) {
  opts = opts || {};
  const cands = [];
  let sheetIndex = 0;
  for (const sheet of sheets) {
    if (sheet.external) { sheetIndex++; continue; }
    for (const r of rules(sheet.css, sheet.name)) {
      const hits = r.decls.filter(d => d.prop === prop);
      if (!hits.length) continue;
      for (const sel of r.selectors) {
        let ok;
        try { ok = matchSelector(sel, chain); }
        catch (e) { if (opts.lenient) continue; throw e; }
        if (!ok) continue;
        if (r.at.length) {
          throw new CascadeRefusal(prop + ' is set inside ' + r.at.join(' / ') +
            ' in ' + sheet.name + ' - this resolver does not evaluate at-rules, ' +
            'so it cannot tell you the winner. Handle that rule explicitly.');
        }
        const spec = specificity(sel);
        for (const d of hits) cands.push({ ...d, sel, spec, sheet: sheet.name, si: sheetIndex, ro: r.order });
      }
    }
    sheetIndex++;
  }
  if (!cands.length) return null;
  cands.sort((x, y) =>
    (x.important ? 1 : 0) - (y.important ? 1 : 0) ||
    cmpSpec(x.spec, y.spec) ||
    x.si - y.si || x.ro - y.ro);
  const win = cands[cands.length - 1];
  return { value: win.value, important: win.important, selector: win.sel,
           sheet: win.sheet, specificity: win.spec, candidates: cands.length };
}

/* ---- 6. what the property ends up as ---------------------------------

   winner() gives the declaration that wins; this follows var() until there
   is a real value, which is what a browser reports and therefore what an
   assertion should compare against.

   This gap was found by checking winner() against Chrome rather than by
   reading it: --badT on WH24 won as "var(--bad, #e2607a)" while the page
   showed #ff7d92, because WH24's own stylesheet sets --bad. Comparing a
   declaration against a hex would have failed in a way that looked like a
   broken test instead of a broken page.

   A missing custom property falls back to the fallback if there is one, and
   otherwise refuses - an unresolvable var() is not a value and must not be
   reported as one. */
function resolve(sheets, chain, prop, depth) {
  depth = depth || 0;
  if (depth > 12) throw new CascadeRefusal('var() nested too deep resolving ' + prop);
  const w = winner(sheets, chain, prop);
  if (!w) return null;
  return { ...w, value: substitute(sheets, chain, w.value, depth) };
}
function substitute(sheets, chain, value, depth) {
  if (depth > 12) throw new CascadeRefusal('var() nested too deep');
  if (value.indexOf('var(') < 0) return value;
  let out = '', i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at < 0) { out += value.slice(i); break; }
    out += value.slice(i, at);
    const close = matchParen(value, at + 3);
    if (close < 0) throw new CascadeRefusal('unbalanced var() in: ' + value);
    const inner = value.slice(at + 4, close);
    const comma = splitTop(inner, ',');
    const name = comma[0].trim();
    const fallback = comma.length > 1 ? comma.slice(1).join(',').trim() : null;
    /* CUSTOM PROPERTIES INHERIT, so a var() used on a button is answered by
       whichever ancestor sets it - almost always <html>. Resolving the name
       against the button alone found nothing and refused, which the browser
       check caught: Chrome painted the Disposed segment #e2607a while this
       said --bad was never set. Walk up from the element to the root and
       take the first ancestor that defines it. */
    const got = lookupVar(sheets, chain, name);
    if (got) out += substitute(sheets, chain, got.value, depth + 1);
    else if (fallback !== null) out += substitute(sheets, chain, fallback, depth + 1);
    else throw new CascadeRefusal(name + ' is used but never set on the element or any ancestor, ' +
      'and has no fallback');
    i = close + 1;
  }
  return out.trim();
}
/* the nearest element from the target up to the root that sets `name` */
function lookupVar(sheets, chain, name) {
  for (let i = chain.length; i >= 1; i--) {
    const w = winner(sheets, chain.slice(0, i), name);
    if (w) return w;
  }
  return null;
}

function matchParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')') { d--; if (!d) return i; }
  }
  return -1;
}

module.exports = { sheetsFor, rules, winner, resolve, specificity, matchSelector, CascadeRefusal };
