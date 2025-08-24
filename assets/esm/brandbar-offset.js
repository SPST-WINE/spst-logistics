(function () {
  const bb = document.querySelector('.brandbar');
  const root = document.documentElement;
  function setOffsets() {
    if (!bb) return;
    const h = bb.getBoundingClientRect().height || bb.offsetHeight || 0;
    root.style.setProperty('--bb-h', h + 'px');
  }
  if (window.ResizeObserver && bb) new ResizeObserver(setOffsets).observe(bb);
  window.addEventListener('load', setOffsets);
  window.addEventListener('resize', setOffsets);
  setOffsets();
})();
