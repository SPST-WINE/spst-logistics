<script>
(function () {
  const tabbar = document.querySelector('.tabbar');
  if (!tabbar) return;

  const tabs = [...tabbar.querySelectorAll('a[data-tab]')];
  const views = {
    spedizioni: document.getElementById('view-spedizioni'),
    preventivi: document.getElementById('view-preventivi')
  };

  function setActive(which) {
    tabs.forEach(a => a.classList.toggle('is-active', a.dataset.tab === which));
    if (views.spedizioni)  views.spedizioni.style.display  = (which === 'spedizioni') ? 'block' : 'none';
    if (views.preventivi)  views.preventivi.style.display  = (which === 'preventivi') ? 'block' : 'none';
  }

  function whichFromHash(h) {
    return (h && h.includes('preventivi')) ? 'preventivi' : 'spedizioni';
  }

  // click: niente scroll, aggiorno hash e UI
  tabs.forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const dest = a.dataset.tab;
      history.replaceState(null, '', a.getAttribute('href')); // aggiorna URL
      setActive(dest);
    });
  });

  // cambio hash (es. link diretto #tab-preventivi)
  window.addEventListener('hashchange', () => setActive(whichFromHash(location.hash)));

  // init
  setActive(whichFromHash(location.hash));
})();
</script>
