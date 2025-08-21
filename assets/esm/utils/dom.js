export function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

export function showBanner(msg){
  const b = document.getElementById('api-banner');
  if(!b) return;
  if(msg){ b.innerHTML = msg; b.classList.add('show'); } else { b.classList.remove('show'); }
}

