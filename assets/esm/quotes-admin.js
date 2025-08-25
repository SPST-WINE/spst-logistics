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
    const index     = Number(wrap.getAttribute('data-option')) || i+1;
    const carrier   = qs('.qa-carrier',  wrap)?.value || '';
    const service   = qs('.qa-service',  wrap)?.value?.trim() || '';
    const transit   = qs('.qa-transit',  wrap)?.value?.trim() || '';
    const incoterm  = qs('.qa-incoterm', wrap)?.value || '';
    const payer     = qs('.qa-payer',    wrap)?.value || '';
    const price     = toNumber(qs('.qa-price',   wrap)?.value);
    const currency  = qs('.qa-currency', wrap)?.value || 'EUR';
    const weight    = toNumber(qs('.qa-weight',  wrap)?.value);
    const notes     = qs('.qa-notes',    wrap)?.value?.trim() || '';
    const recommended = !!qs('.qa-recommend input', wrap)?.checked;
    return { index, carrier, service, transit, incoterm, payer, price, currency, weight, notes, recommended };
  });
}
function isOptionComplete(o){
  return !!(o.carrier && o.service && o.transit && o.incoterm && o.payer && typeof o.price==='number' && o.price>0);
}

function getBestIndex(opts){
  const chosen = document.querySelector('input[name="bestOption"]:checked')?.value;
  if (chosen) return Number(chosen);
  const valid = opts.filter(o => typeof o.price==='number');
  if (!valid.length) return undefined;
  // fallback: la più economica
  valid.sort((a,b)=>a.price-b.price);
  return valid[0]?.index;
}

// Validazione minima per creare
function formIsValid() {
  const email = qs('#customer-email')?.value?.trim();
  const validity = qs('#quote-validity')?.value;
  const opts = readOptions().filter(isOptionComplete);
  return !!(email && validity && opts.length >= 1);
}
// Validazione per preview (basta 1 opzione completa)
function previewIsValid() {
  return readOptions().some(isOptionComplete);
}

function refreshSummary() {
  text(qs('#sum-customer'), qs('#customer-email')?.value?.trim() || '—');
  text(qs('#sum-validity'), fmtDate(qs('#quote-validity')?.value));
  text(qs('#sum-currency'), qs('#quote-currency')?.value || 'EUR');
  const opts = readOptions();
  text(qs('#sum-options'), `${opts.length} opzioni`);
  const best = getBestIndex(opts);
  text(qs('#sum-best'), best ? `Opzione ${best}` : '—');
}

async function handleCreate(ev) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  if (btn.disabled) return;

  if (!formIsValid()) {
    alert('Compila i campi obbligatori (email, validità e almeno 1 opzione completa).');
    return;
  }

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
      slug          : '', // opzionale; in futuro: generazione backend
      linkExpiryDays: toNumber(qs('#link-expiry')?.value) || undefined,
      linkExpiryDate: undefined,
    },
    options: readOptions().filter(isOptionComplete),
  };

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Creo…';

  try {
    const resp = await fetch(`${API_BASE}/api/quotes/create`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    let json=null; try{ json=await resp.json(); }catch{}
    if (!resp.ok || json?.ok === false) {
      console.error('CREATE FAILED →', { status: resp.status, json });
      const msg = json?.error?.message || json?.error || `HTTP ${resp.status}`;
      alert(`Errore durante la creazione del preventivo:\n${msg}`);
      return;
    }
    alert('Preventivo creato! ID: ' + json.id);
  } catch (err) {
    console.error('[quotes-admin] network error:', err);
    alert('Errore di rete durante la creazione del preventivo.');
  } finally {
    btn.disabled = false;
    btn.textContent = prev || 'Crea preventivo';
  }
}

// === Anteprima cliente (statica, locale)
function money(n, curr='EUR'){
  if (typeof n !== 'number') return '—';
  try { return new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(n); }
  catch { return `${n.toFixed(2)} ${curr}`; }
}
function escapeHtml(s=''){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function buildPreviewHtml(model){
  const { customerEmail, currency, validUntil, notes, sender, recipient, options } = model;
  const best = getBestIndex(options) || options[0]?.index;

  const rows = options.map(o => `
    <div class="opt ${o.index===best?'is-best':''}">
      <div class="opt-head">
        <div class="badge">OPZIONE ${o.index}</div>
        ${o.index===best ? '<span class="pill">Consigliata</span>' : ''}
      </div>
      <div class="grid">
        <div><div class="k">Corriere</div><div class="v">${escapeHtml(o.carrier||'—')}</div></div>
        <div><div class="k">Servizio</div><div class="v">${escapeHtml(o.service||'—')}</div></div>
        <div><div class="k">Tempo di resa</div><div class="v">${escapeHtml(o.transit||'—')}</div></div>
        <div><div class="k">Incoterm</div><div class="v">${escapeHtml(o.incoterm||'—')}</div></div>
        <div><div class="k">Oneri a carico</div><div class="v">${escapeHtml(o.payer||'—')}</div></div>
        <div><div class="k">Prezzo</div><div class="v">${money(o.price, o.currency||currency)}</div></div>
        <div><div class="k">Peso reale</div><div class="v">${typeof o.weight==='number' ? o.weight.toFixed(2)+' kg' : '—'}</div></div>
      </div>
      ${o.notes ? `<div class="notes">${escapeHtml(o.notes)}</div>` : ''}
    </div>
  `).join('');

  const html = `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Anteprima Preventivo • SPST</title>
<style>
  :root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}
  .wrap{max-width:960px;margin:24px auto;padding:0 16px}
  .header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand .logo{width:28px;height:28px;background:#f6f;opacity:.0}
  h1{margin:0;font-size:22px}
  .card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .k{font-size:12px;color:var(--muted)} .v{font-weight:600}
  .badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--brand);color:var(--brand);background:rgba(247,145,30,.12);font-size:10px}
  .pill{display:inline-block;padding:4px 9px;border-radius:999px;background:rgba(110,168,255,.15);border:1px solid rgba(110,168,255,.4);font-size:11px}
  .opt{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin:10px 0;background:#0d152a}
  .opt.is-best{box-shadow:inset 0 0 0 1px rgba(110,168,255,.45), 0 6px 16px rgba(0,0,0,.25)}
  .opt-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
  .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .notes{margin-top:8px;color:var(--muted)}
  .small{font-size:12px;color:var(--muted)}
  @media (max-width:900px){ .grid{grid-template-columns:1fr 1fr} .grid2{grid-template-columns:1fr} }
  @media print{ body{background:#fff;color:#000} .card{border-color:#ddd} .opt{background:#fff;border-color:#ddd} .small{color:#444} }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="brand">
        <img class="logo" alt="" />
        <h1>Preventivo SPST</h1>
      </div>
      <div class="small">Valido fino al <strong>${fmtDate(validUntil)}</strong></div>
    </div>

    <div class="card">
      <div class="grid2">
        <div>
          <div class="k">Cliente</div>
          <div class="v">${escapeHtml(customerEmail || '—')}</div>
        </div>
        <div>
          <div class="k">Valuta</div>
          <div class="v">${escapeHtml(currency||'EUR')}</div>
        </div>
      </div>
      ${notes ? `<div style="margin-top:10px"><div class="k">Note</div><div class="v">${escapeHtml(notes)}</div></div>`:''}
    </div>

    <div class="card">
      <div class="grid2">
        <div>
          <div class="k">Mittente</div>
          <div class="v">${escapeHtml(sender?.name||'—')}</div>
          <div class="small">${escapeHtml([sender?.address, sender?.zip, sender?.city, sender?.country].filter(Boolean).join(', '))}</div>
        </div>
        <div>
          <div class="k">Destinatario</div>
          <div class="v">${escapeHtml(recipient?.name||'—')}</div>
          <div class="small">${escapeHtml([recipient?.address, recipient?.zip, recipient?.city, recipient?.country].filter(Boolean).join(', '))}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>
      ${rows || '<div class="small">Nessuna opzione completa.</div>'}
    </div>

    <div class="small" style="margin-top:8px">
      Anteprima non vincolante. I termini e le condizioni SPST si applicano.
    </div>
  </div>
</body></html>`;
  return html;
}

function handlePreview(ev){
  ev.preventDefault();
  if (!previewIsValid()) {
    alert('Per l’anteprima serve almeno 1 opzione compilata (corriere, servizio, incoterm, oneri, prezzo).');
    return;
  }
  const model = {
    customerEmail: qs('#customer-email')?.value?.trim(),
    currency     : qs('#quote-currency')?.value || 'EUR',
    validUntil   : qs('#quote-validity')?.value || null,
    notes        : qs('#quote-notes')?.value?.trim() || '',
    sender       : readSender(),
    recipient    : readRecipient(),
    options      : readOptions().filter(isOptionComplete),
  };
  const html = buildPreviewHtml(model);
  const w = window.open('', '_blank');
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  else { alert('Impossibile aprire la finestra di anteprima (popup bloccato?)'); }
}

// ========== Wiring ==========
function wireup(){
  const view = qs('#view-preventivi');
  if (!view) return;
  const container = qs('#quotes-admin', view);

  // Popola select da config
  const carriers  = (window.BACK_OFFICE_CONFIG?.CARRIERS  || ['DHL','UPS','FedEx','TNT','Privato']);
  const incoterms = (window.BACK_OFFICE_CONFIG?.INCOTERMS || ['EXW','DAP','DDP']);
  qsa('.qa-option', container).forEach(wrap => {
    buildOptions(qs('.qa-carrier',  wrap), carriers,  'Seleziona corriere');
    buildOptions(qs('.qa-incoterm', wrap), incoterms, 'Seleziona incoterm');
  });

  const syncButtons = () => {
    const okCreate  = formIsValid();
    const okPreview = previewIsValid();
    qsa('[data-action="create"], #btn-create', container).forEach(b => b.disabled = !okCreate);
    qsa('#btn-preview', container).forEach(b => b.disabled = !okPreview);
  };

  // Ricalcola riepilogo e stato bottoni
  qsa('input,select,textarea', container).forEach(el => {
    el.addEventListener('input', () => { refreshSummary(); syncButtons(); });
    if (el.name === 'bestOption') el.addEventListener('change', () => { refreshSummary(); });
  });

  // Event delegation: click su crea/preview (alto e basso)
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="create"], #btn-create, #btn-preview');
    if (!btn) return;
    if (btn.id === 'btn-preview') return handlePreview(e);
    return handleCreate(e);
  });

  refreshSummary();
  syncButtons();
}

document.addEventListener('DOMContentLoaded', wireup);
