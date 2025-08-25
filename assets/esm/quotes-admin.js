// assets/esm/quotes-admin.js

// Deduce l'origin giusto (lo script viene servito da spst-logistics.vercel.app)
const API_BASE = new URL(import.meta.url).origin;

// Helpers comodi
const qs  = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const text = (el, v) => { if (el) el.textContent = v ?? '—'; };

function fmtDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(+d)) return '—';
    return d.toISOString().slice(0,10); // YYYY-MM-DD (coerente con Airtable Date)
  } catch { return '—'; }
}

function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }

function buildOptions(select, items, placeholder='Seleziona…') {
  if (!select) return;
  select.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = placeholder; select.appendChild(ph);
  items.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

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

function readOptions() {
  return qsa('.qa-option').map((wrap, i) => {
    const index = Number(wrap.getAttribute('data-option')) || i+1;
    const carrier  = qs('.qa-carrier',  wrap)?.value || '';
    const service  = qs('.qa-service',  wrap)?.value?.trim() || '';
    const transit  = qs('.qa-transit',  wrap)?.value?.trim() || '';
    const incoterm = qs('.qa-incoterm', wrap)?.value || '';
    const payer    = qs('.qa-payer',    wrap)?.value || '';
    const price    = toNumber(qs('.qa-price',   wrap)?.value);
    const currency = qs('.qa-currency', wrap)?.value || 'EUR';
    const weight   = toNumber(qs('.qa-weight',  wrap)?.value);
    const notes    = qs('.qa-notes',    wrap)?.value?.trim() || '';
    const recommended = false; // in futuro: checkbox “Consigliata”

    return { index, carrier, service, transit, incoterm, payer, price, currency, weight, notes, recommended };
  });
}

// Validazione minima per abilitare il bottone
function formIsValid() {
  const email = qs('#customer-email')?.value?.trim();
  const validity = qs('#quote-validity')?.value;
  const opts = readOptions().filter(o =>
    o.carrier && o.service && o.transit && o.incoterm && o.payer && toNumber(o.price) > 0
  );
  return !!(email && validity && opts.length >= 1);
}

function refreshSummary() {
  text(qs('#sum-customer'), qs('#customer-email')?.value?.trim() || '—');
  text(qs('#sum-validity'), fmtDate(qs('#quote-validity')?.value));
  text(qs('#sum-currency'), qs('#quote-currency')?.value || 'EUR');
  text(qs('#sum-options'), `${readOptions().length} opzioni`);
}

async function handleCreate(ev) {
  ev.preventDefault();

  const btn = ev.currentTarget;
  if (btn.disabled) return;

  const body = {
    customerEmail: qs('#customer-email')?.value?.trim(),
    currency    : qs('#quote-currency')?.value || 'EUR',
    validUntil  : qs('#quote-validity')?.value || null,
    notes       : qs('#quote-notes')?.value?.trim() || '',

    sender   : readSender(),
    recipient: readRecipient(),

    terms: {
      version        : qs('#terms-version')?.value || 'v1.0',
      visibility     : qs('#link-visibility')?.value || 'Immediata', // valori allineati ai single select Airtable
      slug           : '', // opzionale: puoi popolarlo in futuro
      linkExpiryDays : toNumber(qs('#link-expiry')?.value) || undefined,
      // opzionale: se vuoi calcolare anche una data precisa di scadenza lato FE
      linkExpiryDate : undefined,
    },

    options: readOptions(),
  };

  if (!formIsValid()) {
    alert('Compila i campi obbligatori (email, validità, almeno 1 opzione completa).');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creo…';

  try {
    const resp = await fetch(`${API_BASE}/api/quotes/create`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json();

    if (!resp.ok || json?.ok === false) {
      const msg = json?.error?.message || json?.error || `HTTP ${resp.status}`;
      console.error('[quotes-admin] create failed:', json);
      alert(`Errore durante la creazione del preventivo:\n${msg}`);
      return;
    }

    // Successo
    alert('Preventivo creato! ID: ' + json.id);
    // Reset soft: mantieni i dati anagrafici se vuoi; al momento non resetto nulla.
  } catch (err) {
    console.error('[quotes-admin] network error:', err);
    alert('Errore di rete durante la creazione del preventivo.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crea preventivo';
  }
}

function wireup() {
  const root = qs('#view-preventivi');
  if (!root) return;

  // Popola select Corriere/Incoterm
  const carriers  = (window.BACK_OFFICE_CONFIG?.CARRIERS  || ['DHL','UPS','FedEx','TNT','Privato']);
  const incoterms = (window.BACK_OFFICE_CONFIG?.INCOTERMS || ['EXW','DAP','DDP']);
  qsa('.qa-option').forEach(wrap => {
    buildOptions(qs('.qa-carrier',  wrap), carriers,  'Seleziona corriere');
    buildOptions(qs('.qa-incoterm', wrap), incoterms, 'Seleziona incoterm');
  });

  // Aggiorna riepilogo e stato del bottone on input
  const inputs = qsa('input,select,textarea', root);
  inputs.forEach(el => el.addEventListener('input', () => {
    refreshSummary();
    qs('#btn-create') && (qs('#btn-create').disabled = !formIsValid());
  }));

  // Primo refresh
  refreshSummary();
  const createBtn = qs('#btn-create');
  if (createBtn) {
    createBtn.disabled = !formIsValid();
    createBtn.addEventListener('click', handleCreate);
  }
}

// Avvio
document.addEventListener('DOMContentLoaded', wireup);
