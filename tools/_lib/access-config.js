/* Who may open the tools.

   A password is never written here. Each entry keeps a random salt and a
   PBKDF2-SHA256 hash of the password, which is what a password file is
   supposed to hold: enough to check a password, not enough to learn it.

   To add someone, open any tool with #adduser on the end of the URL:

       https://emortia.com/tools/site-access/#adduser

   It asks for a username and a password, does the work in the browser, and
   hands you one finished line to paste into the list below. The password
   itself never leaves the machine you typed it on and is never stored.

   To remove someone, delete their line and commit. They are locked out the
   next time their seven days run down - or straight away if you also change
   ACCESS_EPOCH below, which invalidates every session already handed out.

   Read the note at the bottom of this file before you rely on this. */

window.ACCESS_USERS = [
  // { user:'sithara', salt:'…', hash:'…', iter:210000 },
];

/* Who gets owner mode. It is a property of the account, not a passphrase in
   the address bar: sign in as one of these and the owner controls appear,
   on the site and in every tool. */
window.ACCESS_OWNERS = ['sithuwaaa', 'sithuwaaathepage@gmail.com'];

/* ── Who may sign in ──────────────────────────────────────────────────────
   Nobody signs themselves up any more. There is no sign-up form: accounts
   are made by hand and the details handed over. This is the list of who may
   then use them.

   An entry matches a username, a whole address, or - starting with @ - a
   whole domain. A name is matched both as typed and as the address it
   resolves to, so 'tooway' also covers tooway@emortia.local.

   To let a new account in, add its username here and commit. To lock one
   out, delete the line - and bump ACCESS_EPOCH below if you want the session
   they already have to end now rather than when its seven days run down.

   Leave this undefined and anyone with an account may sign in. */
window.ACCESS_ALLOW = [
  'sithuwaaa',                    // owner
  'sithuwaaathepage@gmail.com',   // owner, by address
  'tooway'                        // Tooway Solutions - the team's shared profile
];

/* Signing up from the site is off. The list below is what signUp() checked
   back when there was a form; it is left here because turning sign-ups back
   on is a matter of one flag and this is where the answer to "who?" lives.

     window.ACCESS_SIGNUP = ['sithuwaaathepage@gmail.com', '@dialog.lk'];

   Accounts live in Supabase, so neither list is a wall on its own - the real
   switch is "Allow new users to sign up" in the Supabase dashboard, under
   Authentication → Providers → Email. Turn that off too. */
// window.ACCESS_SIGNUP = [];
/* Set this to true to bring the sign-up form back. */
window.ACCESS_SIGNUP_OPEN = false;

/* A bare username with no @ is given this domain so it can be an account.
   Signing up with a real address is better: it is the only way to get a
   password reset. */
window.ACCESS_DOMAIN = 'emortia.local';

/* Bump this to sign everyone out at once - a signature that no longer matches
   is a session that is no longer valid, whatever its expiry says. */
window.ACCESS_EPOCH = 1;

/* How long a sign-in lasts before it has to be done again. */
window.ACCESS_DAYS = 7;

/* ── What this actually protects ──────────────────────────────────────────
   It keeps the tools out of the hands of someone browsing the site. It does
   not keep anything out of the hands of someone who knows a URL: every file
   in this repository is served publicly by GitHub Pages, so

       emortia.com/tools/site-access/data.json
       emortia.com/tools/site-data/data.json

   can be fetched by anyone, signed in or not, and no code running in a
   browser can change that. A lock drawn by the thing being locked is a
   curtain.

   To make it a real boundary the data has to stop being a file in the repo:
   move both into Supabase behind row level security, where the server checks
   who is asking. The tools already read Supabase for everything else, so this
   is a migration rather than a rewrite. Ask and I will do it.
   ───────────────────────────────────────────────────────────────────────── */
