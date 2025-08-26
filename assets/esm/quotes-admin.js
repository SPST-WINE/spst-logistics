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
function readRecipient() {
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
  valid.sort((a,b)=>a.price-b.price);
  return valid[0]?.index;
}

// Validazione per creare (richiede email, validità e ≥1 opzione completa)
function formIsValid() {
  const email = qs('#customer-email')?.value?.trim();
  const validity = qs('#quote-validity')?.value;
  const opts = readOptions().filter(isOptionComplete);
  return !!(email && validity && opts.length >= 1);
}
// Validazione per preview (basta ≥1 opzione completa)
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

// ====== CREATE ======
let creating = false;

async function handleCreate(ev) {
  ev.preventDefault();
  const btn = ev.currentTarget.closest('button');
  if (btn?.disabled || creating) return;

  if (!formIsValid()) {
    alert('Compila i campi obbligatori (email, validità e almeno 1 opzione completa).');
    return;
  }

  creating = true;
  const prev = btn?.textContent;
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.textContent = 'Creo…'; }

  // costruiamo il body una volta sola, così lo possiamo loggare in caso di errore
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

  // abilita risposta verbosa dal backend
  const url = `${API_BASE}/api/quotes/create${window.BACK_OFFICE_CONFIG?.DEBUG ? '?debug=1' : ''}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });

    let json = null;
    try { json = await resp.json(); } catch { /* no-op */ }

    if (!resp.ok || json?.ok === false) {
      console.error('[CREATE FAILED]', { status: resp.status, url, body, json });
      const msg =
        json?.error?.message ||
        json?.error?.error?.message ||                 // shape tipica Airtable
        json?.error?.type ||
        (typeof json?.error === 'object' ? JSON.stringify(json.error) : json?.error) ||
        `HTTP ${resp.status}`;

      alert(`Errore durante la creazione del preventivo:\n${msg}`);
      return;
    }

    // OK
    const link = json?.url || json?.publicUrl || null;
    alert(`Preventivo creato! ID: ${json?.id}${link ? `\nLink cliente: ${link}` : ''}`);
  } catch (err) {
    console.error('[quotes-admin] network error:', err);
    alert('Errore di rete durante la creazione del preventivo.');
  } finally {
    creating = false;
    if (btn) { btn.disabled = false; btn.dataset.busy = ''; btn.textContent = prev || 'Crea preventivo'; }
  }
}


// ====== PREVIEW (in nuova tab con Blob URL) ======
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
  const best = (function(){
    const chosen = document.querySelector('input[name="bestOption"]:checked')?.value;
    return chosen ? Number(chosen) : (options[0]?.index);
  })();

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
      ${o.notes ? `<div class="notes"><span class="k">Note aggiuntive</span><br/>${escapeHtml(o.notes)}</div>` : ''}
    </div>
  `).join('');

  return `<!doctype html>
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
  .brand img{width:28px;height:28px}
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
  a{color:#9ec1ff;text-decoration:none} a:hover{text-decoration:underline}
  @media (max-width:900px){ .grid{grid-template-columns:1fr 1fr} .grid2{grid-template-columns:1fr} }
  @media print{ body{background:#fff;color:#000} .card{border-color:#ddd} .opt{background:#fff;border-color:#ddd} .small{color:#444} }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="brand">
        <img src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST" />
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
      Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente.
      Per maggiori informazioni consulta i <a href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.
    </div>
  </div>
</body></html>`;
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
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener'); // niente document.write sulla pagina corrente
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
    if (el.name === 'bestOption') el.addEventListener('change', () => { refreshSummary(); syncButtons(); });
  });

  // **UNICO** event listener (delegation) per bottoni top + bottom
  container.addEventListener('click', (e) => {
    const createBtn  = e.target.closest('[data-action="create"], #btn-create');
    const previewBtn = e.target.closest('#btn-preview');
    if (createBtn)  return handleCreate(e);
    if (previewBtn) return handlePreview(e);
  });

  refreshSummary();
  syncButtons();
}

document.addEventListener('DOMContentLoaded', wireup);
