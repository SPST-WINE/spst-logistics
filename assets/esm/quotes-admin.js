// assets/esm/quotes-admin.js

const API_BASE = new URL(import.meta.url).origin;

const qs  = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const text = (el, v) => { if (el) el.textContent = v ?? '—'; };

function fmtDate(value){ if(!value) return '—'; try{ const d=new Date(value); if(Number.isNaN(+d)) return '—'; return d.toISOString().slice(0,10);}catch{ return '—';} }
function toNumber(x){ const n=Number(x); return Number.isFinite(n)?n:undefined; }

function buildOptions(select, items, placeholder='Seleziona…'){
  if(!select) return;
  select.innerHTML='';
  const ph=document.createElement('option');
  ph.value=''; ph.textContent=placeholder; select.appendChild(ph);
  items.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; select.appendChild(o); });
}

function readSender(){ return {
  name:qs('[data-field="sender_name"]')?.value?.trim()||'',
  country:qs('[data-field="sender_country"]')?.value?.trim()||'',
  city:qs('[data-field="sender_city"]')?.value?.trim()||'',
  zip:qs('[data-field="sender_zip"]')?.value?.trim()||'',
  address:qs('[data-field="sender_address"]')?.value?.trim()||'',
  phone:qs('[data-field="sender_phone"]')?.value?.trim()||'',
  tax:qs('[data-field="sender_tax"]')?.value?.trim()||'',
};}

function readRecipient(){ return {
  name:qs('[data-field="rcpt_name"]')?.value?.trim()||'',
  country:qs('[data-field="rcpt_country"]')?.value?.trim()||'',
  city:qs('[data-field="rcpt_city"]')?.value?.trim()||'',
  zip:qs('[data-field="rcpt_zip"]')?.value?.trim()||'',
  address:qs('[data-field="rcpt_address"]')?.value?.trim()||'',
  phone:qs('[data-field="rcpt_phone"]')?.value?.trim()||'',
  tax:qs('[data-field="rcpt_tax"]')?.value?.trim()||'',
};}

function readOptions(){
  return qsa('.qa-option').map((wrap,i)=>{
    const index = Number(wrap.getAttribute('data-option')) || i+1;
    const carrier  = qs('.qa-carrier',wrap)?.value||'';
    const service  = qs('.qa-service',wrap)?.value?.trim()||'';
    const transit  = qs('.qa-transit',wrap)?.value?.trim()||'';
    const incoterm = qs('.qa-incoterm',wrap)?.value||'';
    const payer    = qs('.qa-payer',wrap)?.value||'';
    const price    = toNumber(qs('.qa-price',wrap)?.value);
    const currency = qs('.qa-currency',wrap)?.value||'EUR';
    const weight   = toNumber(qs('.qa-weight',wrap)?.value);
    const notes    = qs('.qa-notes',wrap)?.value?.trim()||'';
    const recommended = !!qs('.qa-recommend input',wrap)?.checked;
    return { index, carrier, service, transit, incoterm, payer, price, currency, weight, notes, recommended };
  });
}

function isOptionComplete(o){
  return !!(o.carrier && o.service && o.transit && o.incoterm && o.payer && typeof o.price==='number' && o.price>0);
}

// ---- bottoni create (header + footer)
const getCreateButtons = () => qsa('[data-action="create"], #btn-create');

function updateCreateButtonsState(){
  const disabled = !formIsValid();
  getCreateButtons().forEach(b=> b.disabled = disabled);
}

function formIsValid(){
  const email = qs('#customer-email')?.value?.trim();
  const validity = qs('#quote-validity')?.value;
  const opts = readOptions().filter(isOptionComplete);
  return !!(email && validity && opts.length>=1);
}

function refreshSummary(){
  const opts = readOptions();
  text(qs('#sum-customer'), qs('#customer-email')?.value?.trim()||'—');
  text(qs('#sum-validity'), fmtDate(qs('#quote-validity')?.value));
  text(qs('#sum-currency'), qs('#quote-currency')?.value||'EUR');
  text(qs('#sum-options'), `${opts.length} opzioni`);
  const best = opts.find(o=>o.recommended)?.index;
  text(qs('#sum-best'), best ? `Opzione ${best}` : '—');
}

function applyRecommendedStyles(){
  qsa('.qa-option').forEach(wrap=>{
    const isRec = !!qs('.qa-recommend input',wrap)?.checked;
    wrap.classList.toggle('is-recommended', isRec);
  });
}

async function handleCreate(ev){
  ev.preventDefault();
  const btn = ev.currentTarget;
  if(btn.disabled) return;

  const body = {
    customerEmail: qs('#customer-email')?.value?.trim(),
    currency     : qs('#quote-currency')?.value||'EUR',
    validUntil   : qs('#quote-validity')?.value||null,
    notes        : qs('#quote-notes')?.value?.trim()||'',
    sender       : readSender(),
    recipient    : readRecipient(),
    terms: {
      version       : qs('#terms-version')?.value || 'v1.0',
      visibility    : qs('#link-visibility')?.value || 'Immediata',
      slug          : '',
      linkExpiryDays: toNumber(qs('#link-expiry')?.value) || undefined,
      linkExpiryDate: undefined,
    },
    options: readOptions().filter(isOptionComplete),
  };

  if(!formIsValid()){
    alert('Compila i campi obbligatori (email, validità, almeno 1 opzione completa).');
    return;
  }

  const all = getCreateButtons();
  all.forEach(b=> b.disabled = true);
  const prev = btn.textContent; btn.textContent = 'Creo…';

  try{
    const resp = await fetch(`${API_BASE}/api/quotes/create`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    let json=null; try{ json = await resp.json(); }catch{}
    if(!resp.ok || json?.ok===false){
      console.error('CREATE FAILED →', {status:resp.status, json});
      const msg = json?.message || json?.error || `HTTP ${resp.status}`;
      alert(`Errore durante la creazione del preventivo:\n${msg}`);
      return;
    }
    alert('Preventivo creato! ID: '+json.id);
  }catch(err){
    console.error('[quotes-admin] network error:', err);
    alert('Errore di rete durante la creazione del preventivo (vedi console).');
  }finally{
    btn.textContent = prev || 'Crea preventivo';
    all.forEach(b=> b.disabled = false);
    updateCreateButtonsState();
  }
}

function wireup(){
  const root = qs('#view-preventivi');
  if(!root) return;

  const carriers  = (window.BACK_OFFICE_CONFIG?.CARRIERS  || ['DHL','UPS','FedEx','TNT','Privato']);
  const incoterms = (window.BACK_OFFICE_CONFIG?.INCOTERMS || ['EXW','DAP','DDP']);
  qsa('.qa-option', root).forEach(wrap=>{
    buildOptions(qs('.qa-carrier',wrap), carriers,'Seleziona corriere');
    buildOptions(qs('.qa-incoterm',wrap), incoterms,'Seleziona incoterm');
  });

  qsa('input,select,textarea', root).forEach(el=>{
    const onAny = ()=>{ refreshSummary(); applyRecommendedStyles(); updateCreateButtonsState(); };
    el.addEventListener('input', onAny);
    el.addEventListener('change', onAny);
  });

  getCreateButtons().forEach(b=> b.addEventListener('click', handleCreate));

  refreshSummary();
  applyRecommendedStyles();
  updateCreateButtonsState();
}

document.addEventListener('DOMContentLoaded', wireup);
