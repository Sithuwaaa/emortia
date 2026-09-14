/* ask.js - asking twice before anything is lost, for every tool and the site.

   Two questions, not one question asked twice. A box that says "are you sure"
   and then says it again only teaches somebody to click through both; the
   second question here says what is actually about to be lost, and naming it
   is the only thing that makes asking again worth anything.

   Built rather than confirm(), because a browser that has just shown two
   confirms in a row offers to suppress the next one - and the one it would
   suppress is the second, which is the one that matters. Escape, a click
   outside and the safe button all cancel, and the safe button has the focus,
   so a stray Enter never agrees to anything.

     Ask.twice([
       { title, body, no: 'Cancel', yes: 'Yes, go on' },
       { title, body, no: 'No, keep it', yes: 'Delete it' }   // red by default
     ]).then(ok => ...)

   A step may carry tone: 'go' for a last step that is not a loss - verifying
   a record, letting a machine back in - so it is not painted like a deletion.

   The look follows whichever page it is on: the tools' --card, --line3 and
   --accent, or the site's --surface2 and --line2, with plain colours behind
   both in case neither is there. */
(function () {
  if (window.Ask) return;

  var CSS =
    '.ask2-back{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;' +
      'background:rgba(4,6,14,.74);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);' +
      'animation:ask2In .14s ease-out}' +
    '.ask2{width:min(440px,100%);max-height:calc(100vh - 40px);overflow-y:auto;box-sizing:border-box;' +
      'background:var(--card,var(--surface2,#1f1519));color:var(--text,#f4efe6);' +
      'border:1px solid var(--line3,var(--line2,rgba(255,255,255,.18)));border-radius:16px;' +
      'padding:20px 20px 18px;box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:left;' +
      "font-family:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
      'animation:ask2Up .18s ease-out}' +
    ".ask2-step{font-family:'Space Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.16em;" +
      'text-transform:uppercase;color:var(--accentB,var(--accent,#d15873));margin:0 0 8px}' +
    ".ask2 h3{font-family:'Bricolage Grotesque','Hanken Grotesk',sans-serif;font-weight:800;font-size:20px;" +
      'line-height:1.2;letter-spacing:-.01em;margin:0 0 8px;color:inherit}' +
    '.ask2 p{font-size:13.5px;line-height:1.65;color:var(--muted,var(--dim,#b9a9ae));margin:0}' +
    '.ask2-btns{display:flex;gap:9px;justify-content:flex-end;flex-wrap:wrap;margin-top:19px}' +
    '.ask2-btns button{font:inherit;font-size:13.5px;padding:9px 15px;border-radius:9px;cursor:pointer;' +
      'background:transparent;color:inherit;border:1px solid var(--line3,var(--line2,rgba(255,255,255,.22)));' +
      'transition:border-color .15s ease,filter .15s ease}' +
    '.ask2-no:hover{border-color:var(--accent,#d15873)}' +
    '.ask2-yes.next{border-color:var(--accent,#d15873);font-weight:600}' +
    '.ask2-yes.bad{background:var(--bad,var(--err,#d9536f));border-color:var(--bad,var(--err,#d9536f));' +
      'color:#fff;font-weight:600}' +
    '.ask2-yes.go{background:var(--accent,#b03a56);border-color:var(--accent,#b03a56);' +
      'color:var(--accent-ink,#fff);font-weight:700}' +
    '.ask2-yes:hover{filter:brightness(1.1)}' +
    '.ask2-btns button:focus-visible{outline:2px solid var(--accentB,var(--accent,#d15873));outline-offset:2px}' +
    '@keyframes ask2In{from{opacity:0}to{opacity:1}}' +
    '@keyframes ask2Up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.ask2-back,.ask2{animation:none}}';

  function style() {
    if (document.getElementById('ask2-css')) return;
    var s = document.createElement('style');
    s.id = 'ask2-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function twice(steps) {
    steps = (steps || []).filter(Boolean);
    if (!steps.length) return Promise.resolve(true);
    style();
    return new Promise(function (resolve) {
      var at = 0;
      var before = document.activeElement;
      var back = document.createElement('div');
      back.className = 'ask2-back';

      function close(ok) {
        document.removeEventListener('keydown', key, true);
        if (back.parentNode) back.parentNode.removeChild(back);
        try { if (before && before.focus) before.focus(); } catch (e) {}
        resolve(ok);
      }
      /* captured, so the page's own Escape - which closes its modals - never
         sees the key that was meant for this box */
      function key(e) {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          close(false);
        }
      }
      function draw() {
        var s = steps[at], last = at === steps.length - 1;
        var tone = s.tone || (last ? 'bad' : 'next');
        back.innerHTML =
          '<div class="ask2" role="alertdialog" aria-modal="true" aria-labelledby="ask2t" aria-describedby="ask2b">' +
            '<div class="ask2-step">Step ' + (at + 1) + ' of ' + steps.length + '</div>' +
            '<h3 id="ask2t">' + esc(s.title) + '</h3>' +
            (s.body ? '<p id="ask2b">' + esc(s.body) + '</p>' : '') +
            '<div class="ask2-btns">' +
              '<button type="button" class="ask2-no">' + esc(s.no || 'Cancel') + '</button>' +
              '<button type="button" class="ask2-yes ' + tone + '">' +
                esc(s.yes || (last ? 'Yes' : 'Yes, go on')) + '</button>' +
            '</div>' +
          '</div>';
        back.querySelector('.ask2-no').onclick = function () { close(false); };
        back.querySelector('.ask2-yes').onclick = function () {
          at++;
          if (at < steps.length) draw(); else close(true);
        };
        back.querySelector('.ask2-no').focus();
      }

      back.addEventListener('click', function (e) { if (e.target === back) close(false); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(back);
      draw();
    });
  }

  window.Ask = { twice: twice };
})();
