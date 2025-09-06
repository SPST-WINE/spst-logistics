// assets/esm/header-tidy.js
// Pulisce e ri-organizza la topbar del Back Office senza cambiare l’HTML lato server.
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const txt = (el) => (el?.textContent || '').trim().toLowerCase();

  function ensureBrandbar() {
    let bb = $('.brandbar');
    if (!bb) {
      bb = document.createElement('div');
      bb.className = 'brandbar';
      const wrap = document.createElement('div');
      wrap.className = 'wrap brandbar-row';
      const left = document.createElement('div');
      left.className = 'brand-left';

      const logo = document.createElement('img');
      logo.className = 'logo';
      logo.src = '/assets/spst-logo.svg';
      logo.alt = 'SPST';

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = 'Back Office';

      left.append(logo, title);
      wrap.append(left);
      bb.append(wrap);

      // mettila sopra l’header se esiste, altrimenti in cima al body
      const hdr = $('header');
      (hdr?.parentNode || document.body).insertBefore(bb, hdr || document.body.firstChild);
    }
    return $('.brandbar .wrap') || bb;
  }

  function moveTrackingLinkToBrandbar() {
    const wrap = ensureBrandbar();

    // trova un link col testo "Tracking Back-Office" ovunque
    let link = $$('a').find((a) => txt(a).includes('tracking back-office'));
    if (!link) {
      link = document.createElement('a');
      link.href = 'https://www.spst.it/tracking-back-office';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Tracking Back-Office';
    }
    link.classList.add('link-orange');

    // se non è già in brandbar, spostalo in fondo (a destra)
    if (link.parentElement !== wrap) wrap.appendChild(link);
  }

  function stripEnvAndStatus() {
    // rimuovi chip/label con quei testi
    $$('.chip, .pill, .badge').forEach((el) => {
      const t = txt(el);
      if (t.includes('evasione ordini') || t.includes('ambiente: airtable')) el.remove();
    });

    // rimuovi select “Tutte/Nuove/…” (se presente)
    const byId = $('#status-filter');
    if (byId) byId.remove();
    else {
      const suspects = $$('select');
      suspects.forEach((s) => {
        const hasStates = $$('option', s).some((o) =>
          /tutte|nuove spedizioni|evase|in elaborazione/i.test(o.textContent)
        );
        if (hasStates) s.remove();
      });
    }
  }

  function arrangeToolbar() {
    const hdrWrap = $('.bo-header .wrap') || $('header .wrap') || $('header') || document.body;

    // toolbar (o creala)
    let tb = $('.bo-header .toolbar', hdrWrap);
    if (!tb) {
      tb = document.createElement('div');
      tb.className = 'toolbar';
      hdrWrap.appendChild(tb);
    }

    // sposta la search nella toolbar (a sinistra)
    const search =
      $('#search') ||
      $$('input[type="text"]').find((i) => /cerca|search/i.test(i.placeholder || ''));
    if (search && search.parentElement !== tb) tb.insertBefore(search, tb.firstChild);

    // porta “Solo non evase” a destra, dentro una chip
    let only = $('#only-open') || $$('input[type="checkbox"]').find((c) => c.id === 'only-open');
    if (only) {
      let chip = only.closest('label.chip');
      if (!chip) {
        chip = document.createElement('label');
        chip.className = 'chip';
        const text = document.createTextNode(' Solo non evase');
        chip.append(only, text);
      }
      chip.style.marginLeft = 'auto';
      tb.appendChild(chip);
    }
  }

  function init() {
    try {
      moveTrackingLinkToBrandbar();
      stripEnvAndStatus();
      arrangeToolbar();
    } catch (e) {
      console.warn('[header-tidy] init failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
