/* Aurora's ambient layers - three wide blooms drifting behind the page
   (hidden by aurora.css for now) and the site's dust rising through it.
   Pairs with skins/aurora.css and stands in for theme.js. Safe anywhere. */
(function () {
  function add() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!document.querySelector('.aurora-layer')) {
      var l = document.createElement('div');
      l.className = 'aurora-layer';
      l.setAttribute('aria-hidden', 'true');
      l.innerHTML = '<i></i><i></i><i></i>';
      document.body.insertBefore(l, document.body.firstChild);
    }
    if (!document.querySelector('.dust-layer')) {
      var d = document.createElement('div');
      d.className = 'dust-layer';
      d.setAttribute('aria-hidden', 'true');
      var rnd = function (a, b) { return a + Math.random() * (b - a); };
      var html = '';
      for (var i = 0; i < 22; i++) {
        var sz = rnd(1.6, 3.6).toFixed(1);
        html += '<span class="dust" style="left:' + rnd(0, 100).toFixed(1) + 'vw;' +
                'width:' + sz + 'px;height:' + sz + 'px;' +
                'animation-duration:' + rnd(16, 34).toFixed(1) + 's;' +
                'animation-delay:-' + rnd(0, 34).toFixed(1) + 's;"></span>';
      }
      d.innerHTML = html;
      document.body.insertBefore(d, document.body.firstChild);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
})();
