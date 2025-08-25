// assets/esm/quotes-admin.js
// Back Office – Preventivi (pulito: niente $ duplicati)

const _q  = (sel, root = document) => root.querySelector(sel);
const _qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const CFG = window.BACK_OFFICE_CONFIG || {};
const LOG = !!CFG.DEBUG;

const ORIGIN = (() => { try { return new URL(CFG.PROXY_BASE).origin; } catch { return location.origin; } })();
const CREATE_URL = `${ORIGIN}/api/quotes/create`;

const ROOT = _q('#quotes-admin');
if (!ROOT) {
  console.warn('[quotes-admin] #quotes-admin non trovato');
}

// Helpers ---------------------------------------------------------------------

function fillSelect(el, items, placeholder) {
  if (!el) return;
  el.innerHTML = '';
  if (placeholder) {
    const p = document.createElement('option');
    p.disabled = true; p.selected = true; p.textContent = placeholder;
    el.appendChild(p);
  }
  (items || []).forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    el.appendChild(o);
  });
}

function collectOption(block, idx) {
  return {
    Indice: idx,
    Corriere: _q('.qa-carrier', block)?.value?.trim() || '',
    Servizio: _q('.qa-service', block)?.value?.trim() || '',
    Tempo_Resa: _q('.qa-transit', block)?.value?.trim() || '',
    Incoterm: _q('.qa-incoterm', block)?.value || '',
    Oneri_A_Carico: _q('.qa-payer', block)?.value || '',
    Prezzo: parseFloat(_q('.qa-price', block)?.value || '0'),
    Valuta: _q('.qa-currency', block)?.value || 'EUR',
    Peso_Kg: parseFloat(_q('.qa-weight', block)?.value || '0'),
    Note_Operative: _q('.qa-notes', block)?.value?.trim() || '',
  };
}

function collectData() {
  const quote = {
    Email_Cliente: _q('#customer-email')?.value.trim() || '',
    Valuta: _q('#quote-currency')?.value || 'EUR',
    Valido_Fino_Al: _q('#quote-validity')?.value || null,
    Note_Globali: _q('#quote-notes')?.value?.trim() || '',

    Mittente_Nome: _q('[data-field="sender_name"]')?.value?.trim() || '',
    Mittente_Paese: _q('[data-field="sender_country"]')?.value?.trim() || '',
    Mittente_Citta: _q('[data-field="sender_city"]')?.value?.trim() || '',
    Mittente_CAP: _q('[data-field="sender_zip"]')?.value?.trim() || '',
    Mittente_Indirizzo: _q('[data-field="sender_address"]')?.value?.trim() || '',
    Mittente_Telefono: _q('[data-field="sender_phone"]')?.value?.trim() || '',
    Mittente_Tax: _q('[data-field="sender_tax"]')?.value?.trim() || '',

    Destinatario_Nome: _q('[data-field="rcpt_name"]')?.value?.trim() || '',
    Destinatario_Paese: _q('[data-field="rcpt_country"]')?.value?.trim() || '',
    Destinatario_Citta: _q('[data-field="rcpt_city"]')?.value?.trim() || '',
    Destinatario_CAP: _q('[data-field="rcpt_zip"]')?.value?.trim() || '',
    Destinatario_Indirizzo: _q('[data-field="rcpt_address"]')?.value?.trim() || '',
    Destinatario_Telefono: _q('[data-field="rcpt_phone"]')?.value?.trim() || '',
    Destinatario_Tax: _q('[data-field="rcpt_tax"]')?.value?.trim() || '',

    Note_Spedizione: _q('#shipment-notes')?.value?.trim() || '',

    Versione_Termini: _q('#terms-version')?.value || '',
    Visibilita: _q('#link-visibility')?.value || 'Immediata',
    Scadenza_Link_Giorni: parseInt(_q('#link-expiry')?.value || '14', 10),
  };

  const options = _qa('.qa-option').map((b, i) => collectOption(b, i + 1))
    .filter(o => o.Corriere || o.Servizio || o.Prezzo);

  return { quote, options };
}

function validate({ quote, options }) {
  if (!quote.Email_Cliente || !quote.Valido_Fino_Al) return false;
  if (options.length === 0) return false;
  const first = options[0];
  if (!first.Corriere || !first.Servizio || !first.Prezzo) return false;
  return true;
}

function refreshSummary() {
  const { quote, options } = collectData();
  const sc = _q('#sum-customer'); if (sc) sc.textContent = quote.Email_Cliente || '—';
  const sv = _q('#sum-validity'); if (sv) sv.textContent = quote.Valido_Fino_Al || '—';
  const cu = _q('#sum-currency'); if (cu) cu.textContent = quote.Valuta || 'EUR';
  const so = _q('#sum-options');  if (so) so.textContent = `${options.length} opzioni`;

  const btn = _q('#btn-create');
  if (btn) btn.disabled = !validate({ quote, options });
}

function bindListeners() {
  _qa('#quotes-admin input, #quotes-admin select, #quotes-admin textarea')
    .forEach(el => {
      el.addEventListener('input', refreshSummary);
      el.addEventListener('change', refreshSummary);
    });
}

function initCombos() {
  const carriers  = CFG.CARRIERS  || ['DHL','UPS','FedEx','TNT','Privato'];
  const incoterms = CFG.INCOTERMS || ['EXW','DAP','DDP'];
  _qa('.qa-option').forEach(block => {
    fillSelect(_q('.qa-carrier', block), carriers, 'Seleziona corriere');
    fillSelect(_q('.qa-incoterm', block), incoterms, 'Seleziona incoterm');
  });
}

// Actions ---------------------------------------------------------------------

async function handleCreate() {
  const data = collectData();
  if (!validate(data)) return;

  try {
    const res = await fetch(CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    console.log('[quotes-admin] Preventivo creato:', json);
    alert('Preventivo creato con successo.');
  } catch (err) {
    console.error('[quotes-admin] Create failed:', err);
    alert('Errore durante la creazione del preventivo.');
  }
}

// Boot ------------------------------------------------------------------------

function init() {
  if (!ROOT) return;
  initCombos();
  bindListeners();
  refreshSummary();
  const btn = _q('#btn-create');
  if (btn) btn.addEventListener('click', e => { e.preventDefault(); handleCreate(); });
  if (LOG) console.log('Persistenza LOCAL attivata');
}
init();
