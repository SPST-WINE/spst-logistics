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
    return d.toISOString().slice(0,10); // YYYY-MM-DD
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
    const recommended = !!qs('.qa-recommend input', wrap)?.checked;
    return { index, carrier, service, transit, incoterm, payer, price, currency, weight, notes, recommended };
  });
}

function isOptionComplete(o) {
  return !!(o.carrier && o.service && o.transit && o.incoterm && o.payer && typeof o.price === 'number' && o.price > 0);
}

// ===== Bottoni "Crea preventivo" (multipli) =====
const getCreateButtons = () => qsa('[data-action="create"]');

function updateCreateButtonsState() {
  const disabled = !formIsValid();
  getCreateButtons().forEach(b => b.disabled = disabled);
}

// Validazione minima per abilitare il bottone
function formIsValid() {
  const email = qs('#customer-email')?.value?.trim();
  const validity = qs('#quote-validity')?.value;
  const opts = readOptions().filter(isOptionComplete);
  return !!(email && validity && opts.length >= 1);
}

function refreshSummary() {
  const opts = readOptions();
  text(qs('#sum-customer'), qs('#customer-email')?.value?.trim() || '—');
  text(qs('#sum-validity'), fmtDate(qs('#quote-validity')?.value));
  text(qs('#sum-currency'), qs('#quote-currency')?.value || 'EUR');
  text(qs('#sum-options'), `${opts.length} opzioni`);

  const best = opts.find(o => o.recommended)?.index;
  text(qs('#sum-best'), best ? `Opzione ${best}` : '—');
}

function applyRecommendedStyles() {
  qsa('.qa-option').forEach(wrap => {
    const isRec = !!qs('.qa-recommend input', wrap)?.checked;
    wrap.classList.toggle('is-recommended', isRec);
  });
}

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
      slug          : '',
      linkExpiryDays: toNumber(qs('#link-expiry')?.value) || undefined,
      linkExpiryDate: undefined,
    },
    options: readOptions().filter(isOptionComplete),
  };

  if (!formIsValid()) {
    alert('Compila i campi obbligatori (email, validità, almeno 1 opzione completa).');
    return;
  }

  // disabilita tutti i bottoni, mostra "Creo…" solo su quello cliccato
  const allCreateBtns = getCreateButtons();
  allCreateBtns.forEach(b => b.disabled = true);
  const prevLabel = btn.textContent;
  btn.textContent = 'Creo…';

  try {
    const resp = await fetch(`${API_BASE}/api/quotes/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let json; try { json = await resp.json(); } catch { json = null; }

    if (!resp.ok || json?.ok === false) {
      console.error('CREATE FAILED →', { status: resp.status, json });
      const msg = json?.message || json?.error || `HTTP ${resp.status}`;
      alert(`Errore durante la creazione del preventivo:\n${msg}`);
      return;
    }

    alert('Preventivo creato! ID: ' + json.id);
    // TODO: redirect alla pagina dettaglio o reset soft dei campi.
  } catch (err) {
    console.error('[quotes-admin] network error:', err);
    alert('Errore di rete durante la creazione del preventivo (vedi console).');
  } finally {
    btn.textContent = prevLabel || 'Crea preventivo';
    allCreateBtns.forEach(b => b.disabled = false);
    updateCreateButtonsState();
  }
}

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

  // Input/change → aggiorna riepilogo, highlight e stato bottoni
  qsa('input,select,textarea', root).forEach(el => {
    el.addEventListener('input', () => {
      refreshSummary();
      applyRecommendedStyles();
      updateCreateButtonsState();
    });
    el.addEventListener('change', () => {
      refreshSummary();
      applyRecommendedStyles();
      updateCreateButtonsState();
    });
  });

  // Wiring bottoni "crea" (header + footer)
  getCreateButtons().forEach(b => b.addEventListener('click', handleCreate));

  // Primo refresh/stato
  refreshSummary();
  applyRecommendedStyles();
  updateCreateButtonsState();
}

// Avvio
document.addEventListener('DOMContentLoaded', wireup);
