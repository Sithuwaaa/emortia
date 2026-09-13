/* Aurora's ambient layer - three wide blooms drifting behind the page.
   Pairs with skins/aurora.css and replaces theme.js's dust. Safe anywhere.
   aurora.css currently hides the layer, so the page background is plain. */
(function () {
  function add() {
    if (document.querySelector('.aurora-layer')) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var l = document.createElement('div');
    l.className = 'aurora-layer';
    l.setAttribute('aria-hidden', 'true');
    l.innerHTML = '<i></i><i></i><i></i>';
    document.body.insertBefore(l, document.body.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
})();
