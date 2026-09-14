/* The dust that rises behind every tool. Pairs with motion.css.
   Does nothing if a dust layer is already there (theme.js adds one on
   the pages that load it) or if the device asks for less motion. */
(function () {
  function addDust() {
    if (document.querySelector('.dust-layer')) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var layer = document.createElement('div');
    layer.className = 'dust-layer';
    layer.setAttribute('aria-hidden', 'true');
    var rnd = function (a, b) { return a + Math.random() * (b - a); };
    var html = '';
    for (var i = 0; i < 22; i++) {
      var sz = rnd(1.6, 3.6).toFixed(1);
      html += '<span class="dust" style="left:' + rnd(0, 100).toFixed(1) + 'vw;' +
              'width:' + sz + 'px;height:' + sz + 'px;' +
              'animation-duration:' + rnd(16, 34).toFixed(1) + 's;' +
              'animation-delay:-' + rnd(0, 34).toFixed(1) + 's;"></span>';
    }
    layer.innerHTML = html;
    document.body.insertBefore(layer, document.body.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addDust);
  else addDust();
})();
