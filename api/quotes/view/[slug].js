// api/quotes/view/[slug].js

/* ---------- ENV ---------- */
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // es. "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;      // es. "OpzioniPreventivo"
const TB_COLLI = process.env.TB_COLLI;        // es. "Colli"

/* ---------- Utils ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]
));
function fmtDate(v){ try{ const d=new Date(v); return Number.isNaN(+d)?'—':d.toISOString().slice(0,10);}catch{ return '—'; } }
function toNum(x, d=0){ const n=Number(x); return Number.isFinite(n)?n:d; }
function money(n, curr='EUR'){ return (typeof n==='number' && Number.isFinite(n))
  ? new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(n)
  : '—'; }
const pick = (obj, keys, fallback='') => {
  for (const k of keys) { if (obj && obj[k] != null && obj[k] !== '') return obj[k]; }
  return fallback;
};

async function atList(table, { filterByFormula, fields, sort, maxRecords, pageSize } = {}) {
  const url = new URL(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`);
  if (filterByFormula) url.searchParams.set('filterByFormula', filterByFormula);
  if (Array.isArray(fields)) fields.forEach(f => url.searchParams.append('fields[]', f));
  if (Array.isArray(sort)) sort.forEach((s,i)=>{
    if (s.field)     url.searchParams.set(`sort[${i}][field]`, s.field);
    if (s.direction) url.searchParams.set(`sort[${i}][direction]`, s.direction);
  });
  if (maxRecords) url.searchParams.set('maxRecords', String(maxRecords));
  if (pageSize)   url.searchParams.set('pageSize',  String(pageSize));

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const j = await r.json().catch(()=>null);
  if (!r.ok) {
    const err = new Error(j?.error?.message || `Airtable ${r.status}`);
    err.status = r.status; err.payload = j;
    throw err;
  }
  return j;
}

/* ---------- HTML ---------- */
function buildHtml({ quote, options, packages }) {
  const bestIdx = (() => {
    const priced = options.filter(o => typeof o.price === 'number').sort((a,b)=>a.price-b.price);
    const chosen = options.find(o => !!o.recommended);
    return chosen?.index ?? priced[0]?.index ?? options[0]?.index ?? null;
  })();

  const pieces = packages.reduce((s,p)=> s + toNum(p.qty,0), 0);
  const weight = packages.reduce((s,p)=> s + (toNum(p.kg ?? p.weight,0) * (toNum(p.qty,0)||0||1)), 0);

  const pkgRows = packages.map(p=>{
    const qty = toNum(p.qty,1);
    const l = toNum(p.l ?? p.length,0);
    const w = toNum(p.w ?? p.width ,0);
    const h = toNum(p.h ?? p.height,0);
    const kg = toNum(p.kg ?? p.weight,0);
    const dims = [l,w,h].map(n=>n.toFixed(1)).join(' × ');
    return `<tr><td>${qty}</td><td>${dims}</td><td>${kg.toFixed(2)}</td></tr>`;
  }).join('');
  const pkgTable = packages.length
    ? `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse">
         <thead><tr>
           <th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">Quantità</th>
           <th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">L × W × H (cm)</th>
           <th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">Peso (kg)</th>
         </tr></thead><tbody>${pkgRows}</tbody></table></div>`
    : `<div class="small">Nessun collo.</div>`;

  const optBlocks = options.length
    ? options.map(o => `
      <div class="opt ${o.index===bestIdx?'is-best':''}">
        <div class="opt-head">
          <div class="badge">OPZIONE ${esc(String(o.index??''))}</div>
          ${o.index===bestIdx ? '<span class="pill">Consigliata</span>' : ''}
        </div>
        <div class="grid">
          <div><div class="k">Corriere</div><div class="v">${esc(o.carrier||'—')}</div></div>
          <div><div class="k">Servizio</div><div class="v">${esc(o.service||'—')}</div></div>
          <div><div class="k">Tempo di resa previsto</div><div class="v">${esc(o.transit||'—')}</div></div>
          <div><div class="k">Incoterm</div><div class="v">${esc(o.incoterm||'—')}</div></div>
          <div><div class="k">Oneri a carico di</div><div class="v">${esc(o.payer||'—')}</div></div>
          <div><div class="k">Prezzo</div><div class="v">${money(o.price, o.currency||quote.currency||'EUR')}</div></div>
        </div>
        ${o.notes ? `<div class="small" style="margin-top:6px"><strong>Note operative:</strong> ${esc(o.notes)}</div>` : ''}
      </div>`).join('')
    : `<div class="small">Nessuna opzione.</div>`;

  const taxSender = quote?.sender?.tax ? `<div class="small">P. IVA / EORI: ${esc(quote.sender.tax)}</div>` : '';
  const taxRcpt   = quote?.recipient?.tax ? `<div class="small">Tax ID / EORI: ${esc(quote.recipient.tax)}</div>` : '';

  return `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preventivo SPST</title>
<style>
:root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}
.wrap{max-width:960px;margin:24px auto;padding:0 16px}
.header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}
.brand{display:flex;align-items:center;gap:10px}.logo{width:26px;height:26px}
h1{margin:0;font-size:22px}
.card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.k{font-size:12px;color:var(--muted)}.v{font-weight:600}
.badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--brand);color:var(--brand);background:rgba(247,145,30,.12);font-size:10px}
.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:rgba(110,168,255,.15);border:1px solid rgba(110,168,255,.4);font-size:11px}
.opt{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin:10px 0;background:#0d152a}
.opt.is-best{box-shadow:inset 0 0 0 1px rgba(110,168,255,.45), 0 6px 16px rgba(0,0,0,.25)}
.opt-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.small{font-size:12px;color:var(--muted)}
table{border-collapse:collapse;width:100%}
th,td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left}
@media (max-width:900px){.grid{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">

  <div class="header">
    <div class="brand">
      <img class="logo" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST logo" />
      <h1>Preventivo SPST</h1>
    </div>
    <div class="small">Valido fino al <strong>${esc(fmtDate(quote?.validUntil))}</strong></div>
  </div>

  <div class="card">
    <div class="grid2">
      <div><div class="k">Cliente</div><div class="v">${esc(quote?.customerEmail||'—')}</div></div>
      <div><div class="k">Valuta</div><div class="v">${esc(quote?.currency||'EUR')}</div></div>
    </div>
    ${quote?.notes ? `<div style="margin-top:10px"><div class="k">Note</div><div class="v">${esc(quote.notes)}</div></div>` : ''}
  </div>

  <div class="card">
    <div class="grid2">
      <div>
        <div class="k">Mittente</div>
        <div class="v">${esc(quote?.sender?.name||'—')}</div>
        <div class="small">${esc([quote?.sender?.address,quote?.sender?.zip,quote?.sender?.city,quote?.sender?.country].filter(Boolean).join(', '))}</div>
        ${taxSender}
      </div>
      <div>
        <div class="k">Destinatario</div>
        <div class="v">${esc(quote?.recipient?.name||'—')}</div>
        <div class="small">${esc([quote?.recipient?.address,quote?.recipient?.zip,quote?.recipient?.city,quote?.recipient?.country].filter(Boolean).join(', '))}</div>
        ${taxRcpt}
      </div>
    </div>
  </div>

  ${quote?.shipmentNotes ? `
  <div class="card">
    <div class="k">Note generiche sulla spedizione</div>
    <div class="v" style="margin-top:6px">${esc(quote.shipmentNotes)}</div>
  </div>` : ''}

  <div class="card">
    <div class="k" style="margin-bottom:6px">Colli</div>
    <div class="small" style="margin-bottom:8px">
      Totale colli: <strong>${pieces}</strong> · Peso reale totale: <strong>${weight.toFixed(2)} kg</strong>
    </div>
    ${pkgTable}
  </div>

  <div class="card">
    <div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>
    ${optBlocks}
  </div>

  <div class="small" style="margin-top:8px">
    Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente.
    Per maggiori informazioni consulta i
    <a style="color:#9ec1ff" href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.
  </div>

</div></body></html>`;
}

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT || !TB_COLLI) {
      return res.status(500).send('Missing Airtable env vars');
    }
    const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
    if (!slug) return res.status(400).send('Missing slug');

    // 1) Preventivo per Slug
    const qResp = await atList(TB_QUOTE, {
      maxRecords: 1,
      filterByFormula: `{Slug_Pubblico} = "${slug}"`
    });
    const qRec = qResp.records?.[0];
    if (!qRec) return res.status(404).send('Preventivo non trovato');

    const f = qRec.fields || {};
    const quote = {
      id           : qRec.id,
      slug         : f.Slug_Pubblico || slug,
      customerEmail: pick(f, ['Email_Cliente','Cliente_Email']),
      currency     : pick(f, ['Valuta','Currency'],'EUR'),
      validUntil   : pick(f, ['Valido_Fino_Al','Validita','Valid_Until'], null),
      notes        : pick(f, ['Note_Globali','Note','Note Globali'], ''),
      shipmentNotes: pick(f, [
        'Note generiche sulla spedizione','Note_Spedizione','Shipment_Notes','Note spedizione'
      ], ''),
      sender: {
        name   : pick(f, ['Mittente_Nome','Mittente Nome','Sender_Name']),
        country: pick(f, ['Mittente_Paese','Mittente Paese','Sender_Country']),
        city   : pick(f, ['Mittente_Citta','Mittente Citta','Sender_City']),
        zip    : pick(f, ['Mittente_CAP','Mittente CAP','Sender_Zip']),
        address: pick(f, ['Mittente_Indirizzo','Mittente Indirizzo','Sender_Address']),
        phone  : pick(f, ['Mittente_Telefono','Mittente Telefono','Sender_Phone']),
        tax    : pick(f, ['Mittente_Tax','PIVA','P.IVA','Sender_Tax']),
      },
      recipient: {
        name   : pick(f, ['Destinatario_Nome','Destinatario Nome','Recipient_Name']),
        country: pick(f, ['Destinatario_Paese','Destinatario Paese','Recipient_Country']),
        city   : pick(f, ['Destinatario_Citta','Destinatario Citta','Recipient_City']),
        zip    : pick(f, ['Destinatario_CAP','Destinatario CAP','Recipient_Zip']),
        address: pick(f, ['Destinatario_Indirizzo','Destinatario Indirizzo','Recipient_Address']),
        phone  : pick(f, ['Destinatario_Telefono','Destinatario Telefono','Recipient_Phone']),
        tax    : pick(f, ['Destinatario_Tax','TaxID','EORI','Recipient_Tax']),
      }
    };

    // 2) Opzioni collegate
    const linkFormula = `OR( FIND("${qRec.id}", ARRAYJOIN({Preventivo})), {Preventivo_Id} = "${qRec.id}" )`;
    let optResp = await atList(TB_OPT, {
      filterByFormula: linkFormula,
      pageSize: 100
    });
    let options = (optResp.records||[]).map(r=>{
      const x = r.fields || {};
      return {
        index: toNum(pick(x, ['Indice','Index','Opzione','Option'], undefined), undefined),
        carrier: pick(x, ['Corriere','Carrier'], ''),
        service: pick(x, ['Servizio','Service'], ''),
        transit: pick(x, ['Tempo_Resa','Tempo di resa previsto','Tempo resa previsto','Transit'], ''),
        incoterm: pick(x, ['Incoterm'], ''),
        payer: pick(x, ['Oneri_A_Carico','Oneri a carico di','Payer'], ''),
        price: (typeof x.Prezzo === 'number') ? x.Prezzo : toNum(x.Prezzo, undefined),
        currency: pick(x, ['Valuta','Currency'], quote.currency || 'EUR'),
        notes: pick(x, ['Note_Operative','Note operative','Notes'], ''),
        recommended: !!pick(x, ['Consigliata','Recommended'], false),
      };
    });

    // Fallback: se 0 opzioni, prova senza filtro e filtra in locale (compatibilità nomi campo)
    if (!options.length) {
      const all = await atList(TB_OPT, { pageSize: 100 });
      options = (all.records||[])
        .filter(r=>{
          const x = r.fields || {};
          const link = x.Preventivo;
          const txt  = x.Preventivo_Id;
          return (Array.isArray(link) && link.includes(qRec.id)) || (txt === qRec.id);
        })
        .map(r=>{
          const x = r.fields || {};
          return {
            index: toNum(pick(x, ['Indice','Index','Opzione','Option'], undefined), undefined),
            carrier: pick(x, ['Corriere','Carrier'], ''),
            service: pick(x, ['Servizio','Service'], ''),
            transit: pick(x, ['Tempo_Resa','Tempo di resa previsto','Tempo resa previsto','Transit'], ''),
            incoterm: pick(x, ['Incoterm'], ''),
            payer: pick(x, ['Oneri_A_Carico','Oneri a carico di','Payer'], ''),
            price: (typeof x.Prezzo === 'number') ? x.Prezzo : toNum(x.Prezzo, undefined),
            currency: pick(x, ['Valuta','Currency'], quote.currency || 'EUR'),
            notes: pick(x, ['Note_Operative','Note operative','Notes'], ''),
            recommended: !!pick(x, ['Consigliata','Recommended'], false),
          };
        });
    }

    // Ordina in locale
    options.sort((a,b)=>{
      if (a.index != null && b.index != null) return a.index - b.index;
      if (a.price != null && b.price != null) return a.price - b.price;
      return 0;
    });

    // 3) Colli collegati
    const pkFilter = `OR( FIND("${qRec.id}", ARRAYJOIN({Preventivo})), {Preventivo_Id} = "${qRec.id}" )`;
    const colliResp = await atList(TB_COLLI, {
      filterByFormula: pkFilter,
      pageSize: 100
    });
    const packages = (colliResp.records||[]).map(r=>{
      const x = r.fields || {};
      return {
        qty: toNum(pick(x, ['Quantita','Qty','Quantità'], 1), 1),
        l  : toNum(pick(x, ['L_cm','Lunghezza','L'], 0), 0),
        w  : toNum(pick(x, ['W_cm','Larghezza','W'], 0), 0),
        h  : toNum(pick(x, ['H_cm','Altezza','H'], 0), 0),
        kg : toNum(pick(x, ['Peso_Kg','Peso','Kg','Weight'], 0), 0),
      };
    });

    const html = buildHtml({ quote, options, packages });
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    console.error('[view/[slug]]', { status: err.status, msg: err.message, payload: err.payload });
    return res.status(err.status || 500).send(`Errore: ${esc(err?.message || 'Server error')}`);
  }
}
