// assets/esm/header-tidy.js
(function () {
  // 1) trova header e tabbar
  const tabbar = document.querySelector('.tabbar');
  const header = (tabbar && (tabbar.closest('header') || tabbar.parentElement))
              || document.querySelector('header');
  if (!header) return;
  header.classList.add('bo-header');

  // 2) rimuovi pill/label superflue
  const kill = (pred) => {
    const n = [...document.querySelectorAll('span,div,small,strong,em')]
      .find(el => pred(el.textContent || ''));
    if (n) n.remove();
  };
  // “Evasione Ordini • ACTIVE”
  kill(txt => /evasione\s+ordini/i.test(txt));
  // “Ambiente: Airtable via Vercel”
  kill(txt => /ambiente:|airtable via vercel/i.test(txt));

  // 3) elimina il selettore stato
  const status = document.getElementById('status-filter');
  (status?.closest('label'))?.remove();
  status?.remove();

  // 4) crea riga strumenti (checkbox + search) sotto le TAB
  const search = document.getElementById('search');
  const only   = document.getElementById('only-open');
  if (tabbar && (search || only)) {
    let row3 = document.querySelector('.bo-tools');
    if (!row3) {
      row3 = document.createElement('div');
      row3.className = 'bo-tools';
      tabbar.insertAdjacentElement('afterend', row3);
    }
    const wrap = (el) => el?.closest('.field') || el?.closest('label') || el;
    const onlyWrap   = wrap(document.querySelector('label[for="only-open"]')) || wrap(only);
    const searchWrap = wrap(search);
    if (onlyWrap)  row3.appendChild(onlyWrap);
    if (searchWrap) row3.appendChild(searchWrap);
  }
})();
