// assets/esm/quotes-admin.js

// Base API: stesso origin del file .js (spst-logistics.vercel.app)
const API_BASE = new URL(import.meta.url).origin;

// === helpers DOM/formatting =================================================
const qs  = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const text = (el, v) => { if (el) el.textContent = v ?? '—'; };

function fmtDate(value){
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(+d)) return '—';
    return d.toISOString().slice(0,10); // YYYY-MM-DD
  } catch { return '—'; }
}

function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }

function buildOptions(select, items, placeholder='Seleziona…'){
  if (!select) return;
  select.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = placeholder;
  select.appendChild(ph);
  items.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    select.appendChild(o);
  });
}

// === lettura campi form =====================================================
function readSender(){
  return {
    name   : qs('[data-field="sender_name"]')?.value?.trim() || '',
    country: qs('[data-field="sender_country"]')?.value?.trim() || '',
    city   : qs('[data-field="sender_city"]')?.value?.trim() || '',
    zip    : qs('[data-field="sender_zip"]')?.value?.trim() || '',
    address: qs('[data-field="sender_address"]')?.value?.trim() || '',
    phone  : qs('[data-field="sender_phone"]')?.value?.trim() || '',
    tax    : qs('[data-field="sender_tax"]')?.value?.trim() || '',
  };
}
function readRecipient(){
  return {
    name   : qs('[data-field="rcpt_name"]')?.value?.trim() || '',
    country: qs('[data-field="rcpt_country"]')?.value?.trim() || '',
    city   : qs('[data-field="rcpt_city"]')?.value?.trim() || '',
    zip    : qs('[data-field="rcpt_zip"]')?.value?.trim() || '',
    address: qs('[data-field="rcpt_address"]')?.value?.trim() || '',
    phone  : qs('[data-field="rcpt_phone"]')?.value?.trim() || '',
    tax    : qs('[data-field="rcpt_tax"]')?.value?.trim() || '',
  };
}

function readOptions(){
  return qsa('.qa-option').map((wrap, i) => {
    const index      = Number(wrap.getAttribute('data-option')) || i+1;
    const carrier    = qs('.qa-carrier',  wrap)?.value || '';
    const service    = qs('.qa-service',  wrap)?.value?.trim() || '';
    const transit    = qs('.qa-transit',  wrap)?.value?.trim() || '';
    const incoterm   = qs('.qa-incoterm', wrap)?.value || '';
    const payer      = qs('.qa-payer',    wrap)?.value || '';
    const price      = toNumber(qs('.qa-price',   wrap)?.value);
    const currency   = qs('.qa-currency', wrap)?.value || 'EUR';
    const weight     = toNumber(qs('.qa-weight',  wrap)?.value);
    const notes      = qs('.qa-notes',    wrap)?.value?.trim() || '';
    const recommended = !!qs('.qa-recommend input', wrap)?.checked;
    return { index, carrier, service, transit, incoterm, payer, price, currency, weight, notes, recommended };
  });
}

function isOptionComplete(o){
  return !!(o.carrier && o.service && o.transit && o.incoterm && o.payer && typeof o.price==='number' && o.price>0);
}
function getBestIndex(){
  const r = qs('input[name="bestOption"]:checked');
  return r ? Number(r.value) : null;
}

// === validazione / riepilogo ===============================================
function formIsValid(){
  const email = qs('#customer-email')?.value?.trim();
  const validity = qs('#quote-validity')?.value;
  const opts = readOptions().filter(isOptionComplete);
  return !!(email && validity && opts.length >= 1);
}

function applyRecommendedStyles(){
  qsa('.qa-option').forEach(wrap => {
    const checked = !!qs('.qa-recommend input', wrap)?.checked;
    wrap.classList.toggle('is-recommended', checked);
  });
}
function refreshSummary(){
  text(qs('#sum-customer'), qs('#customer-email')?.value?.trim() || '—');
  text(qs('#sum-validity'), fmtDate(qs('#quote-validity')?.value));
  text(qs('#sum-currency'), qs('#quote-currency')?.value || 'EUR');
  text(qs('#sum-options'), `${readOptions().length} opzioni`);
  const best = getBestIndex();
  text(qs('#sum-best'), best ? `Opzione ${best}` : '—');
  applyRecommendedStyles();
}

// === gestione BOZZA / PUBBLICAZIONE ========================================
const DRAFT_KEY = 'qa_current_draft_id';
let currentDraftId = sessionStorage.getItem(DRAFT_KEY) || null;

async function handleDraft(ev){
  ev.preventDefault();
  const btn = ev.currentTarget;

  const body = {
    id: currentDraftId || undefined,
    isDraft: true,
    customerEmail: qs('#customer-email')?.value?.trim() || undefined,
    currency     : qs('#quote-currency')?.value || 'EUR',
    validUntil   : qs('#quote-validity')?.value || null,
    notes        : qs('#quote-notes')?.value?.trim() || '',
    sender       : readSender(),
    recipient    : readRecipient(),
    terms: { version: qs('#terms-version')?.value || 'v1.0', visibility: 'Solo_Bozza', slug: '' },
    // in bozza le opzioni non sono obbligatorie; puoi inviarle se vuoi:
    // options: readOptions()
  };

  const allBtns = qsa('[data-action="draft"], [data-action="create"], #btn-create');
  allBtns.forEach(b => b.disabled = true);
  const prev = btn.textContent; btn.textContent = 'Salvo…';

  try{
    const resp = await fetch(`${API_BASE}/api/quotes/create`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const json = await resp.json().catch(()=>null);

    if(!resp.ok || json?.ok===false){
      console.error('DRAFT FAILED →', {status:resp.status, json});
      const msg = json?.message || json?.error || `HTTP ${resp.status}`;
      alert(`Errore nel salvataggio bozza:\n${msg}`);
      return;
    }
    currentDraftId = json.id;
    sessionStorage.setItem(DRAFT_KEY, currentDraftId);
    alert('Bozza salvata ✔');
  }catch(err){
    console.error('[quotes-admin] draft error:', err);
    alert('Errore di rete durante il salvataggio bozza.');
  }finally{
    btn.textContent = prev || 'Salva bozza';
    allBtns.forEach(b => b.disabled = false);
  }
}

async function handleCreate(ev){
  ev.preventDefault();
  const btn = ev.currentTarget;
  if (btn.disabled) return;

  const body = {
    id           : currentDraftId || undefined,
    isDraft      : false,
    customerEmail: qs('#customer-email')?.value?.trim(),
    currency     : qs('#quote-currency')?.value || 'EUR',
    validUntil   : qs('#quote-validity')?.value || null,
    notes        : qs('#quote-notes')?.value?.trim() || '',
    sender       : readSender(),
    recipient    : readRecipient(),
    terms: {
      version       : qs('#terms-version')?.value || 'v1.0',
      visibility    : qs('#link-visibility')?.value || 'Immediata',
      slug          : '',
      linkExpiryDays: toNumber(qs('#link-expiry')?.value) || undefined,
    },
    options: readOptions().filter(isOptionComplete),
  };

  if (!formIsValid()){
    alert('Compila i campi obbligatori (email, validità, almeno 1 opzione completa).');
    return;
  }

  const allCreate = qsa('[data-action="create"], #btn-create');
  allCreate.forEach(b => b.disabled = true);
  const prev = btn.textContent; btn.textContent = 'Creo…';

  try{
    const resp = await fetch(`${API_BASE}/api/quotes/create`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const json = await resp.json().catch(()=>null);

    if(!resp.ok || json?.ok===false){
      console.error('CREATE FAILED →', {status:resp.status, json});
      const msg = json?.message || json?.error || `HTTP ${resp.status}`;
      alert(`Errore durante la creazione del preventivo:\n${msg}`);
      return;
    }

    // pubblicato: reset id bozza
    sessionStorage.removeItem(DRAFT_KEY);
    currentDraftId = null;

    alert('Preventivo PUBBLICATO! ID: ' + json.id);
  }catch(err){
    console.error('[quotes-admin] network error:', err);
    alert('Errore di rete durante la creazione del preventivo.');
  }finally{
    btn.textContent = prev || 'Crea preventivo';
    allCreate.forEach(b => b.disabled = false);
  }
}

// === wiring =================================================================
function wireup(){
  const root = qs('#view-preventivi');
  if (!root) return;

  // Popola select da config
  const carriers  = (window.BACK_OFFICE_CONFIG?.CARRIERS  || ['DHL','UPS','FedEx','TNT','Privato']);
  const incoterms = (window.BACK_OFFICE_CONFIG?.INCOTERMS || ['EXW','DAP','DDP']);
  qsa('.qa-option', root).forEach(wrap => {
    buildOptions(qs('.qa-carrier',  wrap), carriers,  'Seleziona corriere');
    buildOptions(qs('.qa-incoterm', wrap), incoterms, 'Seleziona incoterm');
  });

  // Input → riepilogo + abilitazioni
  qsa('input,select,textarea', root).forEach(el => el.addEventListener('input', () => {
    refreshSummary();
    const createBtns = qsa('[data-action="create"], #btn-create');
    createBtns.forEach(b => b.disabled = !formIsValid());
    // appena tocchi qualcosa, abilito salvataggio bozza
    qsa('[data-action="draft"]').forEach(b => b.disabled = false);
  }));

  // cambio radio consigliata → highlight + riepilogo
  qsa('input[name="bestOption"]').forEach(r => r.addEventListener('change', () => {
    applyRecommendedStyles(); refreshSummary();
  }));

  // Bottoni
  qsa('[data-action="draft"]').forEach(b => b.addEventListener('click', handleDraft));
  qsa('[data-action="create"], #btn-create').forEach(b => b.addEventListener('click', handleCreate));

  // Stato iniziale
  refreshSummary();
  qsa('[data-action="create"], #btn-create').forEach(b => b.disabled = !formIsValid());
  // bozza: abilitata (o se riprendi una bozza, comunque abilitata)
  qsa('[data-action="draft"]').forEach(b => b.disabled = false);

  // ripresa bozza in sessione
  if (currentDraftId){
    qsa('[data-action="draft"], [data-action="create"], #btn-create').forEach(b => b.disabled = false);
  }
}

document.addEventListener('DOMContentLoaded', wireup);
