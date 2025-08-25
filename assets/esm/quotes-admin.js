// assets/esm/quotes-admin.js

// Deduce l'origin giusto (lo script viene servito da spst-logistics.vercel.app)
// Base API: stesso origin dello script (spst-logistics.vercel.app)
const API_BASE = new URL(import.meta.url).origin;

// Helpers comodi
// Helpers
const qs  = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const text = (el, v) => { if (el) el.textContent = v ?? '—'; };
@@ -13,17 +13,22 @@ function fmtDate(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(+d)) return '—';
    return d.toISOString().slice(0,10); // YYYY-MM-DD (coerente con Airtable Date)
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch { return '—'; }
}

function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }
function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function buildOptions(select, items, placeholder='Seleziona…') {
function buildOptions(select, items, placeholder = 'Seleziona…') {
  if (!select) return;
  select.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = placeholder; select.appendChild(ph);
  ph.value = '';
  ph.textContent = placeholder;
  select.appendChild(ph);
  items.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
@@ -60,7 +65,7 @@ function readRecipient() {

function readOptions() {
  return qsa('.qa-option').map((wrap, i) => {
    const index = Number(wrap.getAttribute('data-option')) || i+1;
    const index    = Number(wrap.getAttribute('data-option')) || i + 1;
    const carrier  = qs('.qa-carrier',  wrap)?.value || '';
    const service  = qs('.qa-service',  wrap)?.value?.trim() || '';
    const transit  = qs('.qa-transit',  wrap)?.value?.trim() || '';
@@ -71,18 +76,19 @@ function readOptions() {
    const weight   = toNumber(qs('.qa-weight',  wrap)?.value);
    const notes    = qs('.qa-notes',    wrap)?.value?.trim() || '';
    const recommended = false; // in futuro: checkbox “Consigliata”

    return { index, carrier, service, transit, incoterm, payer, price, currency, weight, notes, recommended };
  });
}

function isOptionComplete(o) {
  return !!(o.carrier && o.service && o.transit && o.incoterm && o.payer && typeof o.price === 'number' && o.price > 0);
}

// Validazione minima per abilitare il bottone
function formIsValid() {
  const email = qs('#customer-email')?.value?.trim();
  const validity = qs('#quote-validity')?.value;
  const opts = readOptions().filter(o =>
    o.carrier && o.service && o.transit && o.incoterm && o.payer && toNumber(o.price) > 0
  );
  const opts = readOptions().filter(isOptionComplete);
  return !!(email && validity && opts.length >= 1);
}

@@ -101,23 +107,19 @@ async function handleCreate(ev) {

  const body = {
    customerEmail: qs('#customer-email')?.value?.trim(),
    currency    : qs('#quote-currency')?.value || 'EUR',
    validUntil  : qs('#quote-validity')?.value || null,
    notes       : qs('#quote-notes')?.value?.trim() || '',

    sender   : readSender(),
    recipient: readRecipient(),

    currency     : qs('#quote-currency')?.value || 'EUR',
    validUntil   : qs('#quote-validity')?.value || null,
    notes        : qs('#quote-notes')?.value?.trim() || '',
    sender       : readSender(),
    recipient    : readRecipient(),
    terms: {
      version        : qs('#terms-version')?.value || 'v1.0',
      visibility     : qs('#link-visibility')?.value || 'Immediata', // valori allineati ai single select Airtable
      slug           : '', // opzionale: puoi popolarlo in futuro
      linkExpiryDays : toNumber(qs('#link-expiry')?.value) || undefined,
      // opzionale: se vuoi calcolare anche una data precisa di scadenza lato FE
      linkExpiryDate : undefined,
      version       : qs('#terms-version')?.value || 'v1.0',
      visibility    : qs('#link-visibility')?.value || 'Immediata', // valori allineati ai single select Airtable
      slug          : '', // opzionale
      linkExpiryDays: toNumber(qs('#link-expiry')?.value) || undefined,
      linkExpiryDate: undefined,
    },

    options: readOptions(),
    options: readOptions().filter(isOptionComplete),
  };

  if (!formIsValid()) {
@@ -126,55 +128,59 @@ async function handleCreate(ev) {
  }

  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = 'Creo…';

  try {
    const resp = await fetch(`${API_BASE}/api/quotes/create`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json();

    let json;
    try { json = await resp.json(); } catch { json = null; }

    if (!resp.ok || json?.ok === false) {
      const msg = json?.error?.message || json?.error || `HTTP ${resp.status}`;
      console.error('[quotes-admin] create failed:', json);
      console.error('CREATE FAILED →', { status: resp.status, json });
      const msg = json?.message || json?.error || `HTTP ${resp.status}`;
      alert(`Errore durante la creazione del preventivo:\n${msg}`);
      return;
    }

    // Successo
    alert('Preventivo creato! ID: ' + json.id);
    // Reset soft: mantieni i dati anagrafici se vuoi; al momento non resetto nulla.
    // Qui potresti fare redirect alla vista del preventivo o pulire il form.
  } catch (err) {
    console.error('[quotes-admin] network error:', err);
    alert('Errore di rete durante la creazione del preventivo.');
    alert('Errore di rete durante la creazione del preventivo (vedi console).');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crea preventivo';
    btn.textContent = prevLabel || 'Crea preventivo';
  }
}

function wireup() {
  const root = qs('#view-preventivi');
  if (!root) return;

  // Popola select Corriere/Incoterm
  // Popola select Corriere/Incoterm dai valori di config
  const carriers  = (window.BACK_OFFICE_CONFIG?.CARRIERS  || ['DHL','UPS','FedEx','TNT','Privato']);
  const incoterms = (window.BACK_OFFICE_CONFIG?.INCOTERMS || ['EXW','DAP','DDP']);
  qsa('.qa-option').forEach(wrap => {
  qsa('.qa-option', root).forEach(wrap => {
    buildOptions(qs('.qa-carrier',  wrap), carriers,  'Seleziona corriere');
    buildOptions(qs('.qa-incoterm', wrap), incoterms, 'Seleziona incoterm');
  });

  // Aggiorna riepilogo e stato del bottone on input
  // Aggiorna riepilogo e abilitazione bottone on input
  const inputs = qsa('input,select,textarea', root);
  inputs.forEach(el => el.addEventListener('input', () => {
    refreshSummary();
    qs('#btn-create') && (qs('#btn-create').disabled = !formIsValid());
    const btn = qs('#btn-create');
    if (btn) btn.disabled = !formIsValid();
  }));

  // Primo refresh
  // Primo refresh + wiring bottone
  refreshSummary();
  const createBtn = qs('#btn-create');
  if (createBtn) {
    
