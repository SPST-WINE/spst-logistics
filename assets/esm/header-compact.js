// assets/esm/header-compact.js
(function(){
  // prova a trovare il container topbar
  const tabbar = document.querySelector('.tabbar');
  const header = (tabbar && (tabbar.closest('header') || tabbar.parentElement))
              || document.querySelector('.topbar')
              || document.querySelector('header');
  if (!header) return;
  header.classList.add('bo-header');

  const onScroll = () => header.classList.toggle('is-compact', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();
