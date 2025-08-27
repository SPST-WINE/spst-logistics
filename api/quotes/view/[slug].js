// api/quotes/view/[slug].js
// Pagina pubblica del preventivo + form "Accetta preventivo"
// Usa i campi di stato e accettazione che ci hai indicato.

const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;      // "OpzioniPreventivo"
const TB_COLLI = process.env.TB_COLLI;        // "Colli"

async function atFetch(path) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${path}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(json?.error?.message || `Airtable HTTP ${resp.status}`);
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const money = (n, curr = "EUR") => (typeof n === "number" ? new Intl.NumberFormat("it-IT", { style: "currency", currency: curr }).format(n) : "—");
const toNum = (x) => { const n = Number(x); return Number.isFinite(n) ? n : undefined; };
function fmtDate(value) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(+d) ? "—" : d.toISOString().slice(0, 10); }

async function loadAll(slug) {
  // Preventivo
  const filter = encodeURIComponent(`{Slug_Pubblico}="${String(slug).replace(/"/g, '\\"')}"`);
  const q = await atFetch(`${encodeURIComponent(TB_QUOTE)}?filterByFormula=${filter}&maxRecords=1`);
  const rec = q.records?.[0];
  if (!rec) return null;
  const qid = rec.id;
  const f = rec.fields;

  // Opzioni
  const fo = encodeURIComponent(`FIND("${qid}", ARRAYJOIN({Preventivo},""))`);
  const sort = encodeURIComponent('[{"field":"Indice","direction":"asc"}]');
  const optResp = await atFetch(`${encodeURIComponent(TB_OPT)}?filterByFormula=${fo}&sort=${sort}`);
  const options = (optResp.records || []).map((r) => r.fields);

  // Colli
  let packages = [];
  if (TB_COLLI) {
    const fp = encodeURIComponent(`FIND("${qid}", ARRAYJOIN({Preventivo},""))`);
    const pkResp = await atFetch(`${encodeURIComponent(TB_COLLI)}?filterByFormula=${fp}`);
    packages = (pkResp.records || []).map((r) => r.fields).map((p) => ({
      qty: toNum(p.Quantita) || 1,
      l: toNum(p.L_cm) ?? toNum(p.Lunghezza) ?? 0,
      w: toNum(p.W_cm) ?? toNum(p.Larghezza) ?? 0,
      h: toNum(p.H_cm) ?? toNum(p.Altezza) ?? 0,
      kg: toNum(p.Peso_Kg) ?? toNum(p.Peso) ?? 0,
    }));
  }

  const pieces = packages.reduce((s, p) => s + (p.qty || 0), 0);
  const weightKg = packages.reduce((s, p) => s + ((p.kg || 0) * (p.qty || 1)), 0);

  return {
    id: qid,
    slug,
    customerEmail: f.Email_Cliente || "",
    currency: f.Valuta || "EUR",
    validUntil: f.Valido_Fino_Al || f.Scadenza || "",
    notes: f.Note_Globali || "",
    shipmentNotes: f.Note_Spedizione || f.Note_Spedizione_Generiche || "",
    sender: {
      name: f.Mittente_Nome || "",
      country: f.Mittente_Paese || "",
      city: f.Mittente_Citta || "",
      zip: f.Mittente_CAP || "",
      address: f.Mittente_Indirizzo || "",
      phone: f.Mittente_Telefono || "",
      tax: f.Mittente_Tax || f.Mittente_PIVA || f.Mittente_EORI || "",
    },
    recipient: {
      name: f.Destinatario_Nome || "",
      country: f.Destinatario_Paese || "",
      city: f.Destinatario_Citta || "",
      zip: f.Destinatario_CAP || "",
      address: f.Destinatario_Indirizzo || "",
      phone: f.Destinatario_Telefono || "",
      tax: f.Destinatario_Tax || f.Destinatario_EIN || f.Destinatario_EORI || "",
    },
    options,
    packages,
    totals: { pieces, weightKg },
    bestIndex: toNum(f.Opzione_Consigliata),
    stato: String(f.Stato || ""),
    acceptedAt: f.Accettato_Il || "",
  };
}

function renderHtml(model) {
  const {
    slug, customerEmail, currency, validUntil, notes, shipmentNotes,
    sender, recipient, options, packages, totals, bestIndex, stato, acceptedAt
  } = model;

  const isAccepted = String(stato).toLowerCase() === "accettato";
  const hasOptions = Array.isArray(options) && options.length > 0;
  const chosen = (bestIndex != null ? Number(bestIndex) : (hasOptions ? Number(options[0].Indice) : null));

  const optBlocks = hasOptions ? options.map((o) => {
    const price = toNum(o.Prezzo);
    const isBest = (Number(o.Indice) === Number(chosen));
    return [
      '<div class="opt', (isBest ? ' is-best' : ''), '">',
        '<div class="opt-head"><div class="badge">OPZIONE ', esc(String(o.Indice ?? '')), '</div>',
        (isBest ? '<span class="pill">Consigliata</span>' : ''), '</div>',
        '<div class="grid">',
          '<div><div class="k">Corriere</div><div class="v">', esc(o.Corriere || '—'), '</div></div>',
          '<div><div class="k">Servizio</div><div class="v">', esc(o.Servizio || '—'), '</div></div>',
          '<div><div class="k">Tempo di resa previsto</div><div class="v">', esc(o.Tempo_Resa || '—'), '</div></div>',
          '<div><div class="k">Incoterm</div><div class="v">', esc(o.Incoterm || '—'), '</div></div>',
          '<div><div class="k">Oneri a carico di</div><div class="v">', esc(o.Oneri_A_Carico || '—'), '</div></div>',
          '<div><div class="k">Prezzo</div><div class="v">', (price != null ? money(price, o.Valuta || currency) : '—'), '</div></div>',
        '</div>',
        (o.Note_Operative ? '<div class="notes"><strong>Note operative:</strong> ' + esc(o.Note_Operative) + '</div>' : ''),
      '</div>',
    ].join('');
  }).join('') : '<div class="small">Nessuna opzione.</div>';

  const pkgRows = (packages || []).map((p) => {
    const dims = [p.l || 0, p.w || 0, p.h || 0].map((n) => Number(n || 0).toFixed(1)).join(' × ');
    return [
      '<tr>',
        '<td style="padding:6px 8px">', (p.qty || 1), '</td>',
        '<td style="padding:6px 8px">', dims, '</td>',
        '<td style="padding:6px 8px">', Number(p.kg || 0).toFixed(2), '</td>',
      '</tr>',
    ].join('');
  }).join('');

  // Card accettazione (solo se non già accettato e ci sono opzioni)
  const acceptCard = (!isAccepted && hasOptions) ? [
    '<div class="card" id="accept-card">',
      '<div class="k" style="margin-bottom:6px">Accetta il preventivo</div>',
      '<form id="accept-form">',
        '<div class="small" style="margin-bottom:10px">Seleziona l’opzione desiderata e conferma i termini.</div>',
        '<div style="margin-bottom:10px"><div class="k">Opzione</div>',
          options.map(o => ([
            '<label style="display:flex;gap:8px;align-items:center;margin:6px 0">',
              '<input type="radio" name="opt" value="', esc(o.Indice) ,'" ',
              (Number(o.Indice)===Number(chosen)?'checked':''), ' />',
              '<span>Opzione ', esc(o.Indice) ,'</span>',
            '</label>'
          ].join(''))).join(''),
        '</div>',
        '<label style="display:flex;gap:8px;align-items:center;margin-top:10px">',
          '<input type="checkbox" id="tos" required />',
          '<span class="small">Dichiaro di accettare i termini di utilizzo.</span>',
        '</label>',
        '<button id="btn-accept" type="submit" class="btn" style="margin-top:12px">Accetta preventivo</button>',
        '<div id="acc-ok" class="small" style="display:none;margin-top:8px">Grazie! La tua accettazione è stata registrata.</div>',
        '<div id="acc-err" class="small" style="display:none;margin-top:8px;color:#f88"></div>',
      '</form>',
    '</div>',
    '<script>',
    '(function(){',
      'const form = document.getElementById("accept-form");',
      'if(!form) return;',
      'form.addEventListener("submit", async function(ev){',
        'ev.preventDefault();',
        'const btn = document.getElementById("btn-accept");',
        'const ok  = document.getElementById("acc-ok");',
        'const err = document.getElementById("acc-err");',
        'ok.style.display="none"; err.style.display="none";',
        'btn.disabled = true; btn.textContent = "Invio…";',
        'try {',
          'const sel = form.querySelector("input[name=\\"opt\\"]:checked");',
          'const payload = { slug: ', JSON.stringify(slug), ', tosAccepted: document.getElementById("tos").checked, optionIndex: sel ? Number(sel.value) : undefined };',
          'const resp = await fetch("/api/quotes/accept", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });',
          'const json = await resp.json().catch(()=>null);',
          'if(!resp.ok || json?.ok===false){ throw new Error(json?.error?.message || json?.error || ("HTTP "+resp.status)); }',
          'ok.style.display="block";',
          'form.querySelectorAll("input,button").forEach(el=>el.disabled=true);',
        '} catch(e){',
          'err.textContent = "Errore: " + (e.message||e);',
          'err.style.display="block";',
        '} finally { btn.disabled=false; btn.textContent="Accetta preventivo"; }',
      '});',
    '})();',
    '</script>',
  ].join('') : '';

  const css = [
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
    '.inp{width:100%;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0a1122;color:#e7ecf5}',
    '.btn{padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.15);background:#142041;color:#fff;cursor:pointer}',
    '.btn[disabled]{opacity:.6;cursor:not-allowed}',
    '.status{font-size:12px;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.2)}',
  ].join('');

  const parts = [];
  parts.push(
    '<!doctype html><html lang="it"><head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<title>Preventivo SPST</title>',
    '<style>', css ,'</style>',
    '</head><body><div class="wrap">'
  );

  // Header + stato
  parts.push(
    '<div class="header"><div class="brand">',
      '<img class="logo" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST logo" />',
      '<h1>Preventivo SPST</h1>',
    '</div>',
    '<div>',
      (isAccepted
        ? '<span class="status" style="background:rgba(110,168,255,.15);border-color:rgba(110,168,255,.4)">Accettato il ' + esc(fmtDate(acceptedAt)) + '</span>'
        : '<span class="small">Valido fino al <strong>' + esc(fmtDate(validUntil)) + '</strong></span>'
      ),
    '</div>',
    '</div>'
  );

  // Card intestazione
  parts.push(
    '<div class="card"><div class="grid2">',
      '<div><div class="k">Cliente</div><div class="v">', esc(customerEmail || '—') ,'</div></div>',
      '<div><div class="k">Valuta</div><div class="v">', esc(currency || 'EUR') ,'</div></div>',
    '</div>',
    (notes ? '<div style="margin-top:10px"><div class="k">Note</div><div class="v">'+esc(notes)+'</div></div>' : ''),
    '</div>'
  );

  // Mittente/Destinatario
  parts.push(
    '<div class="card"><div class="grid2">',
      '<div><div class="k">Mittente</div><div class="v">', esc(sender.name||'—') ,'</div>',
        '<div class="small">', esc([sender.address, sender.zip, sender.city, sender.country].filter(Boolean).join(', ')) ,'</div>',
        (sender.tax ? '<div class="small">P. IVA / EORI: '+esc(sender.tax)+'</div>' : ''),
      '</div>',
      '<div><div class="k">Destinatario</div><div class="v">', esc(recipient.name||'—') ,'</div>',
        '<div class="small">', esc([recipient.address, recipient.zip, recipient.city, recipient.country].filter(Boolean).join(', ')) ,'</div>',
        (recipient.tax ? '<div class="small">Tax ID / EORI: '+esc(recipient.tax)+'</div>' : ''),
      '</div>',
    '</div></div>'
  );

  // Note generiche spedizione
  if (shipmentNotes) {
    parts.push(
      '<div class="card">',
        '<div class="k">Note generiche sulla spedizione</div>',
        '<div class="v" style="margin-top:6px">', esc(shipmentNotes) ,'</div>',
      '</div>'
    );
  }

  // Colli
  parts.push(
    '<div class="card"><div class="k" style="margin-bottom:6px">Colli</div>',
    '<div class="small" style="margin-bottom:8px">Totale colli: <strong>', String(totals.pieces) ,'</strong> · Peso reale totale: <strong>', totals.weightKg.toFixed(2) ,' kg</strong></div>',
    packages.length
      ? '<div style="overflow:auto"><table><thead><tr><th class="k" style="text-align:left">Quantità</th><th class="k" style="text-align:left">L × W × H (cm)</th><th class="k" style="text-align:left">Peso (kg)</th></tr></thead><tbody>'+pkgRows+'</tbody></table></div>'
      : '<div class="small">Nessun collo.</div>',
    '</div>'
  );

  // Opzioni
  parts.push(
    '<div class="card"><div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>',
    optBlocks,
    '</div>'
  );

  // Accettazione
  if (!isAccepted) parts.push(acceptCard);

  // Footer
  parts.push(
    '<div class="small" style="margin-top:8px">Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente. ',
    'Per maggiori informazioni consulta i <a style="color:#9ec1ff" href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.',
    '</div>'
  );

  parts.push('</div></body></html>');
  return parts.join('');
}

export default async function handler(req, res) {
  try {
    const slug = (req.query?.slug || "").toString();
    if (!slug) return res.status(400).send("Errore: slug mancante.");
    if (!AT_BASE || !AT_PAT || !TB_QUOTE) throw new Error("Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI");

    const model = await loadAll(slug);
    if (!model) return res.status(404).send("Preventivo non trovato.");

    const html = renderHtml(model);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("[view/[slug]] error:", err.payload || err.stack || err);
    const msg = err?.payload?.error?.message || err.message || "Server error";
    return res.status(err.status || 500).send("Errore: " + msg);
  }
}
