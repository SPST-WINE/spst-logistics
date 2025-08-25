// assets/esm/quotes-admin.js

// Base API: stesso origin dello script (spst-logistics.vercel.app)
const API_BASE = new URL(import.meta.url).origin;

// Helpers
const qs  = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const text = (el, v) => { if (el) el.textContent = v ?? '—'; };

function fmtDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(+d)) return '—';
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch { return '—'; }
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function buildOptions(select, items, placeholder = 'Seleziona…') {
  if (!select) return;
  select.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  select.appendChild(ph);
  items.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

// -- Lettura anagrafiche
function readSender() {
  const scope = document;
  return {
    name   : qs('[data-field="sender_name"]', scope)?.value?.trim() || '',
    country: qs('[data-field="sender_country"]', scope)?.value?.trim() || '',
    city   : qs('[data-field="sender_city"]', scope)?.value?.trim() || '',
    zip    : qs('[data-field="sender_zip"]', scope)?.value?.trim() || '',
    address: qs('[data-field="sender_address"]', scope)?.value?.trim() || '',
    phone  : qs('[data-field="sender_phone"]', scope)?.value?.trim() || '',
    tax    : qs('[data-field="sender_tax"]', scope)?.value?.trim() || '',
  };
}

function readRecipient() {
  const scope = document;
  return {
    name   : qs('[data-field="rcpt_name"]', scope)?.value?.trim() || '',
    country: qs('[data-field="rcpt_country"]', scope)?.value?.trim() || '',
    city   : qs('[data-field="rcpt_city"]', scope)?.value?.trim() || '',
    zip    : qs('[data-field="rcpt_zip"]', scope)?.value?.trim() || '',
    address: qs('[data-field="rcpt_address"]', scope)?.value?.trim() || '',
    phone  : qs('[data-field="rcpt_phone"]', scope)?.value?.trim() || '',
    tax    : qs('[data-field="rcpt_tax"]', scope)?.value?.trim() || '',
  };
}

// -- Best option helpers
function getBestOptionIndex() {
  const checked = qs('input[name="bestOption"]:checked');
  if (!checked) return null;
  const opt = checked.closest('.qa-option');
  const idx = Number(opt?.getAttribute('data-option'));
  return Number.isFinite(idx) ? idx : null;
}

function isOptionComplete(o) {
  return !!(
    o.carrier &&
    o.service &&
    o.transit &&
    o.incoterm &&
    o.payer &&
    typeof o.price === 'number' &&
    o.price > 0
  );
}

// -- Lettura opzioni (con flag "recommended")
function readOptions() {
  // prendo il radio selezionato UNA volta sola, poi confronto i wrapper
  const best = qs('input[name="bestOption"]:checked');
  const bestWrap = best ? best.closest('.qa-option') : null;

  return qsa('.qa-option').map((wrap, i) => {
    const index    = Number(wrap.getAttribute('data-option')) || i + 1;
    const carrier  = qs('.qa-carrier',  wrap)?.value || '';
    const service  = qs('.qa-service',  wrap)?.value?.trim() || '';
    const transit  = qs('.qa-transit',  wrap)?.value?.trim() || '';
    const incoterm = qs('.qa-incoterm', wrap)?.value || '';
    const payer    = qs('.qa-payer',    wrap)?.value || '';
    const price    = toNumber(qs('.qa-price',   wrap)?.value);
    const currency = qs('.qa-currency', wrap)?.value || 'EUR';
    const weight   = toNumber(qs('.qa-weight',  wrap)?.value);
    const notes    = qs('.qa-notes',    wrap)?.value?.trim() || '';

    const recommended = !!bestWrap && bestWrap === wrap;

    return { index, carrier, service, transit, incoterm, payer, price, currency, weight, notes, recommended };
  });
}

// Validazione minima per abilitare il bottone
function formIsValid() {
  const email = qs('#customer-email')?.value?.trim();
  const validity = qs('#quote-validity')?.value;
  const opts = readOptions().filter(isOptionComplete);
  return !!(email && validity && opts.length >= 1);
}

// Riepilogo laterale
function refreshSummary() {
  text(qs('#sum-customer'), qs('#customer-email')?.value?.trim() || '—');
  text(qs('#sum-validity'), fmtDate(qs('#quote-validity')?.value));
  text(qs('#sum-currency'), qs('#quote-currency')?.value || 'EUR');
  text(qs('#sum-options'), `${readOptions().length} opzioni`);

  const bestIdx = getBestOptionIndex();
  text(qs('#sum-best'), bestIdx ? `Opzione ${bestIdx}` : '—');
}

// Submit
async function handleCreate(ev) {
  ev.preventDefault();

  const btn = ev.currentTarget;
  if (btn.disabled) return;

  const body = {
    customerEmail: qs('#customer-email')?.value?.trim(),
    currency     : qs('#quote-currency')?.value || 'EUR',
    validUntil   : qs('#quote-validity')?.value || null,
    notes        : qs('#quote-notes')?.value?.trim() || '',
    sender       : readSender(),
    recipient    : readRecipient(),
    terms: {
      version       : qs('#terms-version')?.value || 'v1.0',
      visibility    : qs('#link-visibility')?.value || 'Immediata',
      slug          : '', // opzionale
      linkExpiryDays: toNumber(qs('#link-expiry')?.value) || undefined,
      linkExpiryDate: undefined,
    },
    options: readOptions().filter(isOptionComplete),
  };

  if (!formIsValid()) {
    alert('Compila i campi obbligatori (email, validità, almeno 1 opzione completa).');
    return;
  }

  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = 'Creo…';

  try {
    const resp = await fetch(`${API_BASE}/api/quotes/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let json;
    try { json = await resp.json(); } catch { json = null; }

    if (!resp.ok || json?.ok === false) {
      console.error('CREATE FAILED →', { status: resp.status, json });
      const msg = json?.message || json?.error || `HTTP ${resp.status}`;
      alert(`Errore durante la creazione del preventivo:\n${msg}`);
      return;
    }

    alert('Preventivo creato! ID: ' + json.id);
    // TODO: redirect alla vista del preventivo o reset soft del form
  } catch (err) {
    console.error('[quotes-admin] network error:', err);
    alert('Errore di rete durante la creazione del preventivo (vedi console).');
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel || 'Crea preventivo';
  }
}

// Wireup
function wireup() {
  const root = qs('#view-preventivi');
  if (!root) return;

  // Popola select Corriere/Incoterm dai valori di config
  const carriers  = (window.BACK_OFFICE_CONFIG?.CARRIERS  || ['DHL','UPS','FedEx','TNT','Privato']);
  const incoterms = (window.BACK_OFFICE_CONFIG?.INCOTERMS || ['EXW','DAP','DDP']);
  qsa('.qa-option', root).forEach(wrap => {
    buildOptions(qs('.qa-carrier',  wrap), carriers,  'Seleziona corriere');
    buildOptions(qs('.qa-incoterm', wrap), incoterms, 'Seleziona incoterm');
  });

  // Aggiorna riepilogo e abilitazione bottone on input
  const inputs = qsa('input,select,textarea', root);
  inputs.forEach(el => el.addEventListener('input', () => {
    refreshSummary();
    const btn = qs('#btn-create');
    if (btn) btn.disabled = !formIsValid();
  }));

  // Aggiorna riepilogo al cambio della "consigliata"
  qsa('input[name="bestOption"]', root).forEach(r =>
    r.addEventListener('change', refreshSummary)
  );

  // Primo refresh + wiring bottone
  refreshSummary();
  const createBtn = qs('#btn-create');
  if (createBtn) {
    createBtn.disabled = !formIsValid();
    createBtn.addEventListener('click', handleCreate);
  }
}

// Avvio
document.addEventListener('DOMContentLoaded', wireup);
