/* boot.js — applies saved appearance before first paint (no flash of the wrong theme). */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('glm.settings') || '{}');
    var d = document.documentElement;
    if (s.theme === 'light' || s.theme === 'dark') d.setAttribute('data-theme', s.theme);
    d.setAttribute('data-font', s.font || 'serif');
    d.setAttribute('data-size', s.fontSize || 'm');
  } catch (e) { /* storage unavailable */ }
})();
