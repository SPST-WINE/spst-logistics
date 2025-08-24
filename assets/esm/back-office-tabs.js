// assets/esm/back-office-tabs.js
(function () {
  const tabbar = document.querySelector('.tabbar');
  if (!tabbar) return;

  const tabs = [...tabbar.querySelectorAll('a[data-tab]')];
  const views = {
    spedizioni: document.getElementById('view-spedizioni'),
    preventivi: document.getElementById('view-preventivi')
  };

  function setActive(which) {
    tabs.forEach(a => {
      const is = a.dataset.tab === which;
      a.classList.toggle('is-active', is);
      a.setAttribute('aria-current', is ? 'page' : 'false');
    });
    Object.entries(views).forEach(([k, el]) => {
      if (el) el.style.display = (k === which) ? 'block' : 'none';
    });
  }

  function whichFromHash(h) {
    return (h && h.includes('preventivi')) ? 'preventivi' : 'spedizioni';
  }

  // click: niente scroll, aggiorna URL e UI
  tabs.forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const dest = a.dataset.tab;
      history.replaceState(null, '', a.getAttribute('href')); // #tab-...
      setActive(dest);
    });
  });

  // gestisci link diretto #tab-preventivi e cambi di hash esterni
  window.addEventListener('hashchange', () => setActive(whichFromHash(location.hash)));

  // init
  setActive(whichFromHash(location.hash));
})();
