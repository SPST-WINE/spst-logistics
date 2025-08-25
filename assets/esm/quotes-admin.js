// assets/esm/quotes-admin.js
// UI Preventivi: init select, validazione, submit → /api/quotes/create

const CFG = window.BACK_OFFICE_CONFIG || {};
const API_BASE = (CFG.PROXY_BASE || '').replace('/api/airtable', ''); // https://spst-logistics.vercel.app
const ENDPOINT_CREATE = `${API_BASE}/api/quotes/create`;

function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function $(sel, root = document) { return root.querySelector(sel); }

function fillSelect(el, values, placeholder) {
  if (!el) return;
  el.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = placeholder; el.appendChild(opt);
  }
  (values || []).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v; el.appendChild(opt);
  });
}

function initSelects() {
  // Corrieri & Incoterm in tutte le opzioni
  $all('.qa-option').forEach(opt => {
    fillSelect($('.qa-carrier', opt), CFG.CARRIERS || [], 'Seleziona corriere');
    fillSelect($('.qa-incoterm', opt), CFG.INCOTERMS || [], 'Seleziona incoterm');
  });
}

function serializeOption(optEl) {
  const get = (sel) => $(sel, optEl);
  const v = (sel) => (get(sel)?.value || '').trim();
  return {
    corriere: v('.qa-carrier'),
    servizio: v('.qa-service'),
    transitTime: v('.qa-transit'),
    incoterm: v('.qa-incoterm'),
    onericario: v('.qa-payer'),
    prezzo: parseFloat(v('.qa-price') || '0') || 0,
    valuta: v('.qa-currency') || 'EUR',
    pesoRealeKg: parseFloat(v('.qa-weight') || '0') || 0,
    note: v('.qa-notes'),
  };
}

function serializeQuote() {
  const get = (sel) => $(sel);
  const v = (sel) => (get(sel)?.value || '').trim();
  const mitt = {
    ragioneSociale: $('[data-field="sender_name"]')?.value || '',
    paese: $('[data-field="sender_country"]')?.value || '',
    citta: $('[data-field="sender_city"]')?.value || '',
    cap: $('[data-field="sender_zip"]')?.value || '',
    indirizzo: $('[data-field="sender_address"]')?.value || '',
    telefono: $('[data-field="sender_phone"]')?.value || '',
    pivaEori: $('[data-field="sender_tax"]')?.value || '',
  };
  const dest = {
    ragioneSociale: $('[data-field="rcpt_name"]')?.value || '',
    paese: $('[data-field="rcpt_country"]')?.value || '',
    citta: $('[data-field="rcpt_city"]')?.value || '',
    zip: $('[data-field="rcpt_zip"]')?.value || '',
    indirizzo: $('[data-field="rcpt_address"]')?.value || '',
    telefono: $('[data-field="rcpt_phone"]')?.value || '',
    taxIdEori: $('[data-field="rcpt_tax"]')?.value || '',
  };
  const opzioni = $all('.qa-option').map(serializeOption);

  return {
    cliente: {
      email: v('#customer-email'),
      valuta: v('#quote-currency') || 'EUR',
      validita: v('#quote-validity') || null,
      note: v('#quote-notes'),
    },
    mittente: mitt,
    destinatario: dest,
    noteSpedizione: v('#shipment-notes'),
    opzioni,
    termini: {
      versione: v('#terms-version') || 'v1.0',
      visibilita: v('#link-visibility') || 'Subito',
      scadenzaGiorni: parseInt(v('#link-expiry') || '14', 10) || 14,
    },
  };
}

function canSubmit(payload) {
  if (!payload?.cliente?.email || !/\S+@\S+\.\S+/.test(payload.cliente.email)) return false;
  const validOpts = (payload.opzioni || []).filter(
    o => o.corriere && o.servizio && o.incoterm && o.prezzo > 0
  );
  return validOpts.length >= 1;
}

function setBtnState(disabled) {
  const btn = $('#btn-create');
  if (btn) btn.disabled = !!disabled;
}

function showToast(msg, ok = true) {
  const t = document.getElementById('toast');
  if (!t) return alert(msg);
  t.textContent = msg;
  t.className = 'toast show ' + (ok ? '' : 'err');
  setTimeout(() => { t.className = 'toast'; }, 2500);
}

async function handleCreate() {
  const payload = serializeQuote();
  if (!canSubmit(payload)) {
    showToast('Compila i campi obbligatori (email + almeno 1 opzione completa)', false);
    return;
  }
  setBtnState(true);
  try {
    const r = await fetch(ENDPOINT_CREATE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok || !data?.ok) throw new Error(data?.error || 'Errore creazione preventivo');

    // Successo
    showToast('Preventivo creato ✅');
    if (data.publicUrl) {
      // mostralo dove vuoi; per ora semplice alert/copia
      console.log('Link pubblico:', data.publicUrl);
    }
  } catch (err) {
    console.error(err);
    showToast('Errore: ' + (err.message || err), false);
  } finally {
    setBtnState(false);
  }
}

function refreshSummary() {
  const p = serializeQuote();
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('sum-customer', p?.cliente?.email || '—');
  set('sum-validity', p?.cliente?.validita || '—');
  set('sum-currency', p?.cliente?.valuta || 'EUR');

  const validOpts = (p.opzioni || []).filter(o => o.corriere && o.servizio && o.incoterm);
  set('sum-options', `${validOpts.length} ${validOpts.length === 1 ? 'opzione' : 'opzioni'}`);

  setBtnState(!canSubmit(p));
}

function bindListeners() {
  // Ascolta tutti i campi che influenzano la validità / riepilogo
  const selectors = [
    '#customer-email', '#quote-currency', '#quote-validity', '#quote-notes',
    '[data-field="sender_name"]','[data-field="sender_country"]','[data-field="sender_city"]',
    '[data-field="sender_zip"]','[data-field="sender_address"]','[data-field="sender_phone"]','[data-field="sender_tax"]',
    '[data-field="rcpt_name"]','[data-field="rcpt_country"]','[data-field="rcpt_city"]','[data-field="rcpt_zip"]',
    '[data-field="rcpt_address"]','[data-field="rcpt_phone"]','[data-field="rcpt_tax"]',
    '#shipment-notes', '#terms-version', '#link-visibility', '#link-expiry',
    '.qa-carrier','.qa-service','.qa-transit','.qa-incoterm','.qa-payer','.qa-price','.qa-currency','.qa-weight','.qa-notes'
  ];
  selectors.forEach(sel => $all(sel).forEach(el => el.addEventListener('input', refreshSummary)));
  const btn = document.getElementById('btn-create');
  if (btn) btn.addEventListener('click', handleCreate);
}

function init() {
  initSelects();
  bindListeners();
  refreshSummary();
}

document.addEventListener('DOMContentLoaded', init);

// === helpers ===============================================================
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const ISO = d => d ? new Date(d).toISOString() : null;

// mappa select a stringa “pulita”
const val = el => (el?.value ?? '').trim();

// === 1) COSTRUISCI PAYLOAD PREVENTIVO secondo i CAMPI AIRTABLE =============
function collectQuote() {
  return {
    // Tabella Preventivi
    Email_Cliente: val($('#customer-email')),
    Valuta: val($('#quote-currency')) || 'EUR',
    Valido_Fino_Al: val($('#quote-validity')),         // input type="date" → YYYY-MM-DD ok per Airtable
    Note_Globali: val($('#quote-notes')),

    Versione_Termini: val($('#terms-version')),
    Visibilita: val($('#link-visibility')) === 'Solo bozza' ? 'Solo_Bozza' : 'Immediata',

    Stato: 'Bozza',            // iniziale; “Pubblicato” lo metteremo in /publish
    // Mittente_*
    Mittente_RagioneSociale: val($('[data-field="sender_name"]')),
    Mittente_Paese:           val($('[data-field="sender_country"]')),
    Mittente_Citta:           val($('[data-field="sender_city"]')),
    Mittente_CAP:             val($('[data-field="sender_zip"]')),
    Mittente_Indirizzo:       val($('[data-field="sender_address"]')),
    Mittente_Telefono:        val($('[data-field="sender_phone"]')),
    Mittente_TaxID:           val($('[data-field="sender_tax"]')),
    // Destinatario_*
    Destinatario_RagioneSociale: val($('[data-field="rcpt_name"]')),
    Destinatario_Paese:          val($('[data-field="rcpt_country"]')),
    Destinatario_Citta:          val($('[data-field="rcpt_city"]')),
    Destinatario_CAP:            val($('[data-field="rcpt_zip"]')),
    Destinatario_Indirizzo:      val($('[data-field="rcpt_address"]')),
    Destinatario_Telefono:       val($('[data-field="rcpt_phone"]')),
    Destinatario_TaxID:          val($('[data-field="rcpt_tax"]')),
  };
}

// === 2) OPZIONI (tabella OpzioniPreventivo) ================================
function collectOptions() {
  return $$('.qa-option').map(card => {
    const idx = Number(card.getAttribute('data-option') || 0);
    return {
      Indice: idx,
      Corriere: val(card.querySelector('.qa-carrier')),
      Servizio: val(card.querySelector('.qa-service')),
      Tempo_Resa: val(card.querySelector('.qa-transit')),
      Incoterm: val(card.querySelector('.qa-incoterm')),
      Oneri_A_Carico: val(card.querySelector('.qa-payer')),
      Prezzo: Number(card.querySelector('.qa-price')?.value || 0),
      Valuta: val(card.querySelector('.qa-currency')) || 'EUR',
      Peso_Kg: Number(card.querySelector('.qa-weight')?.value || 0),
      Note_Operative: val(card.querySelector('.qa-notes')),
      Consigliata: false,
    };
  }).filter(o => o.Corriere || o.Prezzo); // tieni solo opzioni “compilate”
}

// === 3) VALIDAZIONE MINIMA ==================================================
function canCreate() {
  const q = collectQuote();
  const opts = collectOptions();
  const emailOk = /\S+@\S+\.\S+/.test(q.Email_Cliente || '');
  const hasOneOpt = opts.some(o => o.Corriere && o.Incoterm && o.Prezzo > 0);
  return emailOk && q.Valido_Fino_Al && hasOneOpt;
}

// === 4) ABILITA BOTTONI =====================================================
function wireEnableButtons() {
  const inputs = $$(
    '#quotes-admin input, #quotes-admin select, #quotes-admin textarea'
  );
  const btnCreate = $('#btn-create') || document.querySelector('.qa-header .btn.primary[title="Crea preventivo"]');
  const btnPreview = $('#btn-preview');

  const refresh = () => {
    const ok = canCreate();
    if (btnCreate) btnCreate.disabled = !ok;
    if (btnPreview) btnPreview.disabled = !window.__LAST_QUOTE_ID__;
  };
  inputs.forEach(i => i.addEventListener('input', refresh));
  refresh();
}

// === 5) CREA PREVENTIVO (chiama la tua API /api/quotes/create) =============
async function handleCreate(e) {
  e?.preventDefault?.();
  if (!canCreate()) return alert('Compila email, validità e almeno 1 opzione completa.');

  const payload = {
    quote: collectQuote(),
    options: collectOptions(),
  };

  const resp = await fetch('/api/quotes/create', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (!resp.ok) return alert(json.error || 'Errore creazione');

  // salva id per publish/anteprima
  window.__LAST_QUOTE_ID__ = json.id;
  (document.getElementById('btn-preview') || {}).disabled = false;

  // feedback
  console.log('Creato:', json);
  alert('Preventivo creato ✔️');
}

// === 6) PUBLISH (genera link pubblico) =====================================
async function handlePreview() {
  const id = window.__LAST_QUOTE_ID__;
  if (!id) return alert('Prima crea il preventivo.');
  const days = Number($('#link-expiry')?.value || 14);

  const resp = await fetch('/api/quotes/publish', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ quoteId: id, expiryDays: days }),
  });
  const j = await resp.json();
  if (!resp.ok) return alert(j.error || 'Errore pubblicazione');
  window.open(j.url, '_blank');
}

// === boot ==================================================================
export function initQuotesAdmin() {
  // popola select Corriere/Incoterm se non lo fai già altrove
  const carriers = (window.BACK_OFFICE_CONFIG?.CARRIERS || []);
  const incoterms = (window.BACK_OFFICE_CONFIG?.INCOTERMS || []);
  $$('.qa-carrier').forEach(s => {
    s.innerHTML = '<option value="">Seleziona corriere</option>' +
      carriers.map(c=>`<option>${c}</option>`).join('');
  });
  $$('.qa-incoterm').forEach(s => {
    s.innerHTML = '<option value="">Seleziona incoterm</option>' +
      incoterms.map(c=>`<option>${c}</option>`).join('');
  });

  wireEnableButtons();

  // aggancia bottoni (rispetta i tuoi id/class esistenti)
  (document.getElementById('btn-create') ||
   document.querySelector('.qa-header .btn.primary[title="Crea preventivo"]'))
    ?.addEventListener('click', handleCreate);

  document.getElementById('btn-preview')
    ?.addEventListener('click', handlePreview);
}

