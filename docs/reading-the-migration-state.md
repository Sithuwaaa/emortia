# Reading the migration state

Three things that have each cost a wasted hour. Read this before telling
anyone which migrations are applied.

## 1. prosrc comes back CRLF, so every function looks different

The SQL Editor converts line endings on paste. The files in `supabase/`
are LF; the bodies stored in Postgres are CRLF. Hash or compare them
naively and all ten warehouse functions read as "different from the
file", which looks exactly like *nothing is applied* – and the obvious
next move from there is to paste ten migrations that are already in.

Normalise `chr(13)` out before comparing:

```sql
select p.proname,
       md5(replace(pg_get_functiondef(p.oid), chr(13), '')) as body_md5
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'wh\_%'
order by p.proname;
```

The same applies to any `prosrc` diff by eye: a file and its live
function can be character-identical and still show a change on every
line.

## 2. The file order is not a run order

`supabase/` is numbered, so the numbers look like instructions. They are
not. Several migrations remove what an earlier one wrote to, which makes
the earlier one impossible to re-run against the schema the rest leave
behind:

- 056 seeds `wh_vendors`; 059 drops it
- 057 reads `drum_cur`; 057 drops it
- 059 selects from `wh_projects`, `wh_parties`, `wh_sources`; 059 drops all three

Eleven files are in that position – every one carrying a function body
that reads `drum_cur` is in the same boat. Run the check rather than
reasoning about it:

```powershell
node tools/_lib/migrations-replay.js
```

It lists each file, what it can no longer find, and which migration took
it away. `migrations-replay.test.js` declares the eleven, so the list
cannot grow without someone looking: drop a column an older migration
still writes to and the suite fails, naming both files.

A list derived from the file names is **unverified**. Label it that way
wherever it is printed.

## 3. If you cannot read the database, say so and stop

Applied-or-not is a fact about the database and nothing in this
repository knows it. When a Supabase read is refused – `You do not have
permission` – the correct output is "the database was unreadable", not
an order inferred from file numbers. Inferring it once nearly cost ten
unnecessary pastes, three of which could not have succeeded.

`node tools/_lib/migrations.test.js --live` asks the database directly
and exits 2 when it has no credentials rather than guessing. A marker it
checks has to be absent from every earlier definition of the same
function, because identity is not recency: a function can match a file
it has not been updated to.
