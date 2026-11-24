/* wh-drum-balance.js - every drum's range against what it still owes.

     node tools/_lib/wh-drum-balance.js          the query, to paste
     node tools/_lib/wh-drum-balance.js --live   run it, needs a token

   THE INVARIANT I WAS GIVEN, AND WHY IT IS IN TWO PARTS.

   It came to me as

     orig_span - sum(outstanding OBN qty) = live_span

   and that flags drums that are perfectly healthy. A drum issued WHOLE
   has one outstanding line for its entire length and readings that
   never moved, so an uncut 500 m drum standing on a site reads
   500 - 500 = 0 against a live span of 500 and comes out -500. Every
   whole-drum issue in the table would be reported wrong. My own test
   caught it on the second case, which is the only reason I noticed.

   The split that holds:

     A.  live_span = orig_span - (outstanding CUT metres)
         A cut is the only thing that moves the readings, so this is
         true whatever state the drum is in.

     B.  status 'out'  ->  exactly one whole-drum line outstanding, and
                           its quantity equals live_span
         status 'in'   ->  no whole-drum line outstanding at all

   A drum cannot be on a shelf and on a site, and B is where that is
   actually said. The drum in the report fails B: it is 'out', it reads
   its full 500 m, and the whole-drum line against it says 140 - the
   length it had when it left, before deletes restored metres onto a
   range that had never been reduced. A says nothing about it, which is
   exactly why the one-line version missed the shape it was written
   for.

   WHAT COUNTS AS OUTSTANDING: an OBN line against the item, less
   whatever has come back against that line through returns_line.

   --live needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF, and
   exits 2 when they are absent rather than reporting a clean run it
   did not do. */

const https = require('https');

const SQL = `
with line_out as (
  select l.item_id,
         (l.cut_from is not null) as is_cut,
         sum(l.qty - coalesce((select sum(r.qty) from wh_lines r
                                where r.returns_line = l.id), 0)) as owed,
         count(*) as lines
    from wh_lines l
    join wh_notes n on n.id = l.note_id
   where n.kind = 'OBN'
   group by l.item_id, (l.cut_from is not null)
)
select i.id, i.drum_name, i.status, i.out_note,
       (i.orig_upper - i.orig_lower) as orig_span,
       (i.drum_upper - i.drum_lower) as live_span,
       coalesce((select owed  from line_out c where c.item_id = i.id and c.is_cut), 0) as cut_out,
       coalesce((select owed  from line_out w where w.item_id = i.id and not w.is_cut), 0) as whole_out,
       coalesce((select lines from line_out w where w.item_id = i.id and not w.is_cut), 0) as whole_lines
  from wh_items i
 where i.drum_name is not null
   and i.orig_upper is not null and i.drum_upper is not null
 order by i.drum_name;
`.trim();

/* the two rules, on one row, with no database in sight */
function check(row) {
  const orig = (+row.orig_upper) - (+row.orig_lower);
  const live = (+row.drum_upper) - (+row.drum_lower);
  const cut = +row.cut_out || 0, whole = +row.whole_out || 0, wl = +row.whole_lines || 0;
  const faults = [];
  if (live !== orig - cut)
    faults.push('reads ' + live + ' but came in at ' + orig + ' with ' + cut + ' m cut and still out');
  if (row.status === 'out') {
    if (wl !== 1) faults.push('is out on a note but has ' + wl + ' whole-drum lines outstanding');
    else if (whole !== live)
      faults.push('is out whole for ' + whole + ' m but reads ' + live + ' m');
  } else if (wl > 0) {
    faults.push('is in stock but ' + whole + ' m of it is out whole');
  }
  return { orig, live, cut, whole, ok: faults.length === 0, faults };
}

module.exports = { SQL, check };

if (require.main === module) {
  if (!process.argv.includes('--live')) {
    console.log('-- every drum: what came in, what is still out, what the readings say');
    console.log('-- paste into Supabase SQL Editor, or run with --live\n');
    console.log(SQL);
    console.log('\n-- live_span must equal orig_span - cut_out.');
    console.log('-- status out: exactly one whole line, and whole_out = live_span.');
    console.log('-- status in:  no whole line at all.');
    process.exit(0);
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    console.log('--live needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.');
    console.log('Without them this cannot say anything about the database, and');
    console.log('it will not report a clean run it did not do.');
    process.exit(2);
  }
  const body = JSON.stringify({ query: SQL });
  const req = https.request({
    hostname: 'api.supabase.com', path: '/v1/projects/' + ref + '/database/query', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
               'Content-Length': Buffer.byteLength(body) }
  }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => {
      let rows; try { rows = JSON.parse(d); } catch (e) { console.log(d.slice(0, 400)); process.exit(1); }
      if (!Array.isArray(rows)) { console.log(JSON.stringify(rows).slice(0, 400)); process.exit(1); }
      let bad = 0;
      for (const r of rows) {
        const c = check(r);
        if (!c.ok) bad++;
        console.log((c.ok ? '  ok   ' : 'WRONG  ') + String(r.drum_name).padEnd(14)
          + ' in ' + String(c.orig).padStart(6) + '  cut out ' + String(c.cut).padStart(6)
          + '  reads ' + String(c.live).padStart(6) + '  ' + r.status
          + (c.ok ? '' : '\n         ' + c.faults.join('\n         ')));
      }
      console.log('\n' + rows.length + ' drum(s), ' + bad + ' out of balance');
      process.exit(bad ? 1 : 0);
    });
  });
  req.on('error', e => { console.log(e.message); process.exit(1); });
  req.end(body);
}
