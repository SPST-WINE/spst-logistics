// assets/esm/quotes-admin.js
const API_BASE = new URL(import.meta.url).origin;

/* ------------------------- Helpers di base ------------------------- */
const qs  = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const text = (el, v) => { if (el) el.textContent = v ?? "—"; };

function fmtDate(value) {
  if (!value) return "—";
  try { const d = new Date(value); if (Number.isNaN(+d)) return "—"; return d.toISOString().slice(0,10); }
  catch { return "—"; }
}
function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }

function buildOptions(select, items, placeholder="Seleziona…") {
  if (!select) return;
  select.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = placeholder; select.appendChild(ph);
  items.forEach(v => { const opt = document.createElement("option"); opt.value = v; opt.textContent = v; select.appendChild(opt); });
}

// Sostituisci money() con questa versione
function money(n, curr='EUR'){
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  try { return new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(num); }
  catch { return `${num.toFixed(2)} ${curr}`; }
}
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* --------------------------- Colli (Packages) --------------------------- */
function pkgRowElement(p={qty:1,l:'',w:'',h:'',kg:''}){
  const row = document.createElement('div');
  row.className = 'pkg-row';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '120px repeat(3,1fr) 140px 80px';
  row.style.gap = '8px';
  row.style.margin = '6px 0';
  row.innerHTML =
    '<input type="number" min="1" step="1" class="pkg-qty" value="'+(p.qty ?? 1)+'" />' +
    '<input type="number" min="0" step="0.1" class="pkg-l" placeholder="lunghezza" value="'+(p.l ?? '')+'" />' +
    '<input type="number" min="0" step="0.1" class="pkg-w" placeholder="larghezza" value="'+(p.w ?? '')+'" />' +
    '<input type="number" min="0" step="0.1" class="pkg-h" placeholder="altezza" value="'+(p.h ?? '')+'" />' +
    '<input type="number" min="0" step="0.01" class="pkg-kg" placeholder="kg" value="'+(p.kg ?? '')+'" />' +
    '<span class="pkg-remove" style="align-self:center;cursor:pointer;color:#f66;user-select:none">Elimina</span>';
  return row;
}
function addPackageRow(p){ const rows = qs('#qa-pkg-rows'); if (rows) rows.appendChild(pkgRowElement(p)); }

function readPackages(){
  const rows = qs('#qa-pkg-rows');
  if (!rows) return [];
  return qsa('.pkg-row', rows).map(r => ({
    qty: toNumber(qs('.pkg-qty', r)?.value) || 0,
    l  : toNumber(qs('.pkg-l',   r)?.value),
    w  : toNumber(qs('.pkg-w',   r)?.value),
    h  : toNumber(qs('.pkg-h',   r)?.value),
    kg : toNumber(qs('.pkg-kg',  r)?.value),
  })).filter(p => p.qty > 0);
}
function refreshPackages(){
  const pkgs = readPackages();
  const totQty = pkgs.reduce((s,p)=> s + (p.qty||0), 0);
  const totKg  = pkgs.reduce((s,p)=> s + (p.kg||0) * (p.qty||1), 0);
  text(qs('#qa-pkg-totals'), `Totale colli: ${totQty} · Peso reale totale: ${totKg.toFixed(2)} kg`);
  text(qs('#sum-packages'), totQty ? `${totQty} collo${totQty===1?'':'i'} (${totKg.toFixed(2)} kg)` : '—');
}
function wirePackages(onChange){
  const rows = qs('#qa-pkg-rows');
  const add  = qs('#qa-pkg-add');
  const changed = () => { refreshPackages(); if (onChange) onChange(); };

  add?.addEventListener('click', () => { addPackageRow({ qty:1 }); changed(); });
  rows?.addEventListener('input', (e) => { if (e.target.closest('.pkg-row')) changed(); });
  rows?.addEventListener('click', (e) => {
    if (e.target.matches('.pkg-remove')) { e.preventDefault(); e.target.closest('.pkg-row')?.remove(); changed(); }
  });

  if (!rows?.children.length) { addPackageRow({ qty:1 }); changed(); }
}

/* -------------------------- Lettura form -------------------------- */
function readSender() {
  return {
    name   : qs('[data-field="sender_name"]')?.value?.trim() || "",
    country: qs('[data-field="sender_country"]')?.value?.trim() || "",
    city   : qs('[data-field="sender_city"]')?.value?.trim() || "",
    zip    : qs('[data-field="sender_zip"]')?.value?.trim() || "",
    address: qs('[data-field="sender_address"]')?.value?.trim() || "",
    phone  : qs('[data-field="sender_phone"]')?.value?.trim() || "",
    tax    : qs('[data-field="sender_tax"]')?.value?.trim() || "",
  };
}
function readRecipient() {
  return {
    name   : qs('[data-field="rcpt_name"]')?.value?.trim() || "",
    country: qs('[data-field="rcpt_country"]')?.value?.trim() || "",
    city   : qs('[data-field="rcpt_city"]')?.value?.trim() || "",
    zip    : qs('[data-field="rcpt_zip"]')?.value?.trim() || "",
    address: qs('[data-field="rcpt_address"]')?.value?.trim() || "",
    phone  : qs('[data-field="rcpt_phone"]')?.value?.trim() || "",
    tax    : qs('[data-field="rcpt_tax"]')?.value?.trim() || "",
  };
}
function readOptions() {
  return qsa(".qa-option").map((wrap, i) => {
    const index     = Number(wrap.getAttribute("data-option")) || i+1;
    const carrier   = qs(".qa-carrier",  wrap)?.value || "";
    const service   = qs(".qa-service",  wrap)?.value?.trim() || "";
    const transit   = qs(".qa-transit",  wrap)?.value?.trim() || "";
    const incoterm  = qs(".qa-incoterm", wrap)?.value || "";
    const payer     = qs(".qa-payer",    wrap)?.value || "";
    const price     = toNumber(qs(".qa-price",   wrap)?.value);
    const currency  = qs(".qa-currency", wrap)?.value || "EUR";
    const notes     = qs(".qa-notes",    wrap)?.value?.trim() || "";
    const recommended = !!qs(".qa-recommend input", wrap)?.checked;
    return { index, carrier, service, transit, incoterm, payer, price, currency, notes, recommended };
  });
}
function isOptionComplete(o){
  return !!(o.carrier && o.service && o.transit && o.incoterm && o.payer && typeof o.price==="number" && o.price>0);
}
function getBestIndex(opts){
  const chosen = document.querySelector('input[name="bestOption"]:checked')?.value;
  if (chosen) return Number(chosen);
  const valid = opts.filter(o => typeof o.price === "number").sort((a,b)=>a.price-b.price);
  return valid[0]?.index;
}

/* --------------------- Validazione + Riepilogo --------------------- */
function formIsValid() {
  const email = qs("#customer-email")?.value?.trim();
  const validity = qs("#quote-validity")?.value;
  const opts = readOptions().filter(isOptionComplete);
  const pkgs = readPackages();
  return !!(email && validity && opts.length >= 1 && pkgs.length >= 1);
}
function previewIsValid() {
  return readOptions().some(isOptionComplete) && readPackages().length >= 1;
}
function refreshSummary() {
  text(qs("#sum-customer"), qs("#customer-email")?.value?.trim() || "—");
  text(qs("#sum-validity"), fmtDate(qs("#quote-validity")?.value));
  text(qs("#sum-currency"), qs("#quote-currency")?.value || "EUR");
  refreshPackages();
  const best = getBestIndex(readOptions());
  text(qs("#sum-best"), best ? `Opzione ${best}` : "—");
}

/* ------------------------ Anteprima cliente ------------------------ */
function buildPreviewHtml(model){
  const customerEmail = model.customerEmail || '';
  const currency      = model.currency || 'EUR';
  const validUntil    = model.validUntil || '';
  const notes         = model.notes || '';
  const shipmentNotes = model.shipmentNotes || '';   // <<< NEW
  const sender        = model.sender || {};
  const recipient     = model.recipient || {};
  const options       = Array.isArray(model.options) ? model.options : [];
  const packages      = Array.isArray(model.packages) ? model.packages : [];

  const best = getBestIndex(options) || (options[0]?.index ?? null);

  // Opzioni
  const optRows = options.map(o => (
    '<div class="opt ' + (o.index===best?'is-best':'') + '">' +
      '<div class="opt-head">' +
        '<div class="badge">OPZIONE ' + escapeHtml(String(o.index ?? '')) + '</div>' +
        (o.index===best ? '<span class="pill">Consigliata</span>' : '') +
      '</div>' +
      '<div class="grid">' +
        '<div><div class="k">Corriere</div><div class="v">' + escapeHtml(o.carrier||'—') + '</div></div>' +
        '<div><div class="k">Servizio</div><div class="v">' + escapeHtml(o.service||'—') + '</div></div>' +
        '<div><div class="k">Tempo di resa previsto</div><div class="v">' + escapeHtml(o.transit||'—') + '</div></div>' +
        '<div><div class="k">Incoterm</div><div class="v">' + escapeHtml(o.incoterm||'—') + '</div></div>' +
        '<div><div class="k">Oneri a carico di</div><div class="v">' + escapeHtml(o.payer||'—') + '</div></div>' +
        '<div><div class="k">Prezzo</div><div class="v">' + money(o.price, o.currency||currency) + '</div></div>' +
      '</div>' +
      (o.notes ? '<div class="notes"><strong>Note operative:</strong> ' + escapeHtml(o.notes) + '</div>' : '') +
    '</div>'
  )).join('');

  // Totali colli
  const pkgPieces = packages.reduce((s,p)=> s + (Number(p.qty)||0), 0);
  const pkgWeight = packages.reduce((s,p)=>{
    const kg = Number(p.kg ?? p.weight ?? 0);
    const q  = Number(p.qty) || 0;
    return s + (Number.isFinite(kg)?kg:0) * (q || 0 || 1);
  }, 0);

  // Tabella colli
  let pkgTable = '';
  if (packages.length){
    const rows = packages.map(p => {
      const qty = Number(p.qty) || 1;
      const l = Number(p.l ?? p.length ?? 0);
      const w = Number(p.w ?? p.width  ?? 0);
      const h = Number(p.h ?? p.height ?? 0);
      const kg = Number(p.kg ?? p.weight ?? 0);
      const dims = [l,w,h].map(n => (Number.isFinite(n)?n:0).toFixed(1)).join(' × ');
      const kgFmt = (Number.isFinite(kg)?kg:0).toFixed(2);
      return (
        '<tr>' +
          '<td style="padding:6px 8px">' + qty   + '</td>' +
          '<td style="padding:6px 8px">' + dims  + '</td>' +
          '<td style="padding:6px 8px">' + kgFmt + '</td>' +
        '</tr>'
      );
    }).join('');
    pkgTable =
      '<div style="overflow:auto">' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr>' +
            '<th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">Quantità</th>' +
            '<th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">L × W × H (cm)</th>' +
            '<th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">Peso (kg)</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  // Blocchi indirizzo (con P.IVA / TAX ID)
  const senderBits = [];
  senderBits.push('<div><div class="k">Mittente</div><div class="v">', escapeHtml(sender.name||'—') ,'</div>');
  senderBits.push('<div class="small">', escapeHtml([sender.address, sender.zip, sender.city, sender.country].filter(Boolean).join(', ')) ,'</div>');
  if (sender.tax) senderBits.push('<div class="small">P. IVA / EORI: ', escapeHtml(sender.tax) ,'</div>');
  senderBits.push('</div>');

  const recipientBits = [];
  recipientBits.push('<div><div class="k">Destinatario</div><div class="v">', escapeHtml(recipient.name||'—') ,'</div>');
  recipientBits.push('<div class="small">', escapeHtml([recipient.address, recipient.zip, recipient.city, recipient.country].filter(Boolean).join(', ')) ,'</div>');
  if (recipient.tax) recipientBits.push('<div class="small">Tax ID / EORI: ', escapeHtml(recipient.tax) ,'</div>');
  recipientBits.push('</div>');

  // HTML finale
  const parts = [];
  parts.push(
    '<!doctype html><html lang="it"><head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<title>Anteprima Preventivo • SPST</title>',
    '<style>',
      ':root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}',
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}',
      '.wrap{max-width:960px;margin:24px auto;padding:0 16px}',
      '.header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}',
      '.brand{display:flex;align-items:center;gap:10px}.logo{width:26px;height:26px}',
      'h1{margin:0;font-size:22px}',
      '.card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0}',
      '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.k{font-size:12px;color:var(--muted)}.v{font-weight:600}',
      '.badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--brand);color:var(--brand);background:rgba(247,145,30,.12);font-size:10px}',
      '.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:rgba(110,168,255,.15);border:1px solid rgba(110,168,255,.4);font-size:11px}',
      '.opt{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin:10px 0;background:#0d152a}',
      '.opt.is-best{box-shadow:inset 0 0 0 1px rgba(110,168,255,.45), 0 6px 16px rgba(0,0,0,.25)}',
      '.opt-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}',
      '.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
      '.notes{margin-top:8px;color:var(--muted)}.small{font-size:12px;color:var(--muted)}',
      '@media (max-width:900px){.grid{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}}',
      'table{border-collapse:collapse;width:100%}th,td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left}',
    '</style></head><body><div class="wrap">'
  );

  // Header
  parts.push(
    '<div class="header"><div class="brand">',
      '<img class="logo" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST logo" />',
      '<h1>Preventivo SPST</h1>',
    '</div>',
    '<div class="small">Valido fino al <strong>', escapeHtml(fmtDate(validUntil)) ,'</strong></div>',
    '</div>'
  );

  // Card: intestazione
  parts.push(
    '<div class="card"><div class="grid2">',
      '<div><div class="k">Cliente</div><div class="v">', escapeHtml(customerEmail||'—') ,'</div></div>',
      '<div><div class="k">Valuta</div><div class="v">',   escapeHtml(currency||'EUR') ,'</div></div>',
    '</div>'
  );
  if (notes) parts.push('<div style="margin-top:10px"><div class="k">Note</div><div class="v">', escapeHtml(notes) ,'</div></div>');
  parts.push('</div>');

  // Card: indirizzi (con P.IVA / TAX ID)
  parts.push(
    '<div class="card"><div class="grid2">',
      senderBits.join(''),
      recipientBits.join(''),
    '</div></div>'
  );

  // Card: note generiche spedizione (se presenti)
  if (shipmentNotes) {
    parts.push(
      '<div class="card">',
        '<div class="k" style="margin-bottom:6px">Note generiche sulla spedizione</div>',
        '<div class="v">', escapeHtml(shipmentNotes) ,'</div>',
      '</div>'
    );
  }

  // Card: colli
  parts.push(
    '<div class="card"><div class="k" style="margin-bottom:6px">Colli</div>',
    '<div class="small" style="margin-bottom:8px">Totale colli: <strong>', String(pkgPieces) ,'</strong> · Peso reale totale: <strong>', pkgWeight.toFixed(2) ,' kg</strong></div>',
    pkgTable || '',
    '</div>'
  );

  // Card: opzioni
  parts.push(
    '<div class="card"><div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>',
    (optRows || '<div class="small">Nessuna opzione completa.</div>'),
    '</div>'
  );

  // Footer
  parts.push(
    '<div class="small" style="margin-top:8px">Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente. ',
    'Per maggiori informazioni consulta i <a style="color:#9ec1ff" href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.',
    '</div>'
  );

  parts.push('</div></body></html>');
  return parts.join('');
}

function openHtmlInNewTab(html) {
  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
}

/* ---------------------- Crea preventivo (API) ---------------------- */
let creating = false;
async function handleCreate(ev) {
  ev.preventDefault();
  const btn = ev.currentTarget.closest("button");
  if (btn?.disabled) return;

  if (!formIsValid()) { alert("Compila i campi obbligatori (email, validità, almeno 1 collo e almeno 1 opzione completa)."); return; }
  if (creating) return;
  creating = true;
  const prev = btn?.textContent;
  if (btn){ btn.disabled = true; btn.dataset.busy = "1"; btn.textContent = "Creo…"; }

  try {
    const body = {
      customerEmail: qs("#customer-email")?.value?.trim(),
      currency     : qs("#quote-currency")?.value || "EUR",
      validUntil   : qs("#quote-validity")?.value || null,
      notes        : qs("#quote-notes")?.value?.trim() || "",
      sender       : readSender(),
      recipient    : readRecipient(),
      packages     : readPackages(),
      shipmentNotes: qs("#shipment-notes")?.value?.trim() || "",
      terms: {
        version       : qs("#terms-version")?.value || "v1.0",
        visibility    : qs("#link-visibility")?.value || "Immediata",
        slug          : "",
        linkExpiryDays: toNumber(qs("#link-expiry")?.value) || undefined,
        linkExpiryDate: undefined,
      },
      options: readOptions().filter(isOptionComplete),
    };

    const endpoint = `${API_BASE}/api/quotes/create${ev?.altKey ? '?debug=1' : ''}`;
    const resp = await fetch(endpoint, { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body) });

    let json=null; try{ json=await resp.json(); }catch{}
    if (!resp.ok || json?.ok === false) {
      console.error("CREATE FAILED →", { status: resp.status, json });
      const pretty = json?.error?.message || json?.error?.type || (json?.error ? JSON.stringify(json.error, null, 2) : `HTTP ${resp.status}`);
      alert(`Errore durante la creazione del preventivo:\n${pretty}`);
      return;
    }

    if (json?.debug) {
      console.log("[DEBUG create] wouldCreate:", json.wouldCreate);
      console.log("[DEBUG create] packages:", body.packages);
      alert("Modalità debug: nessun record creato.\nControlla la console per il payload inviato.");
      return;
    }

    if (json?.url) {
      try { await navigator.clipboard.writeText(json.url); } catch {}
      window.open(json.url, "_blank", "noopener");
      alert(`Preventivo creato!\nID: ${json.id}\nIl link pubblico è stato aperto in una nuova scheda e copiato negli appunti.`);
    } else {
      alert("Preventivo creato! ID: " + (json?.id || "—"));
    }
  } catch (err) {
    console.error("[quotes-admin] network error:", err);
    alert("Errore di rete durante la creazione del preventivo.");
  } finally {
    creating = false;
    if (btn){ btn.disabled = !formIsValid(); btn.dataset.busy = ""; btn.textContent = prev || "Crea preventivo"; }
  }
}

/* ------------------------- Anteprima locale ------------------------ */
function handlePreview(ev){
  ev.preventDefault();
  if (!previewIsValid()) {
    alert("Per l’anteprima serve almeno 1 collo e almeno 1 opzione (corriere, servizio, incoterm, oneri, prezzo).");
    return;
  }
  const model = {
    customerEmail: qs("#customer-email")?.value?.trim(),
    currency     : qs("#quote-currency")?.value || "EUR",
    validUntil   : qs("#quote-validity")?.value || null,
    notes        : qs("#quote-notes")?.value?.trim() || "",
    shipmentNotes: qs("#shipment-notes")?.value?.trim() || "",   // <<< NEW
    sender       : readSender(),
    recipient    : readRecipient(),
    packages     : readPackages(),
    options      : readOptions().filter(isOptionComplete),
  };
  openHtmlInNewTab(buildPreviewHtml(model));
}


/* ---------------------- UI: consigliata (pill) --------------------- */
function wireRecommendedUI(container){
  const radios = qsa('input[name="bestOption"]', container);
  const apply = () => {
    const val = document.querySelector('input[name="bestOption"]:checked')?.value;
    qsa('.qa-option', container).forEach(wrap => {
      if (!val) { wrap.classList.remove('is-recommended'); return; }
      wrap.classList.toggle('is-recommended', String(wrap.getAttribute('data-option')) === String(val));
    });
  };
  radios.forEach(r => r.addEventListener('change', () => { apply(); refreshSummary(); }));
  apply();
}

/* ----------------------------- Wiring ------------------------------ */
function wireup(){
  const view = qs("#view-preventivi");
  if (!view) return;
  const container = qs("#quotes-admin", view);

  // Popola select
  const carriers  = (window.BACK_OFFICE_CONFIG?.CARRIERS  || ["DHL","UPS","FedEx","TNT","Privato"]);
  const incoterms = (window.BACK_OFFICE_CONFIG?.INCOTERMS || ["EXW","DAP","DDP"]);
  qsa(".qa-option", container).forEach(wrap => {
    buildOptions(qs(".qa-carrier",  wrap), carriers,  "Seleziona corriere");
    buildOptions(qs(".qa-incoterm", wrap), incoterms, "Seleziona incoterm");
  });

  // Pulsanti
  const syncButtons = () => {
    const okCreate  = formIsValid();
    const okPreview = previewIsValid();
    qsa('[data-action="create"], #btn-create', container).forEach(b => b.disabled = !okCreate);
    qsa("#btn-preview", container).forEach(b => b.disabled = !okPreview);
  };

  // Sezione colli (definito dopo syncButtons per evitare ReferenceError)
  wirePackages(() => { refreshSummary(); syncButtons(); });

  // Ricalcolo riepilogo/stato bottoni su tutti gli input
  qsa("input,select,textarea", container).forEach(el => {
    el.addEventListener("input", () => { refreshSummary(); syncButtons(); });
    if (el.name === "bestOption") el.addEventListener("change", () => { refreshSummary(); syncButtons(); });
  });

  // Click bottoni
  container.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="create"], #btn-create, #btn-preview');
    if (!btn) return;
    if (btn.id === "btn-preview") return handlePreview(e);
    if (btn.matches('[data-action="create"]') || btn.id === "btn-create") return handleCreate(e);
  });
  qs("#btn-create", container)?.addEventListener("click", handleCreate);
  qs("#btn-preview", container)?.addEventListener("click", handlePreview);

  wireRecommendedUI(container);
  refreshSummary();
  syncButtons();
}

document.addEventListener("DOMContentLoaded", wireup);
