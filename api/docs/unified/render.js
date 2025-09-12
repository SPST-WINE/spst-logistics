// /api/docs/unified/render.js
// Runtime: Node.js (Vercel Node 20). Nessun Puppeteer: HTML pronto per Stampa/Salva PDF.
export const config = { runtime: "nodejs" };

import crypto from "node:crypto";

/* ──────────────────────────────────────────────────────────────────────────
   ENV
────────────────────────────────────────────────────────────────────────── */
const env = (k, d) => process.env[k] ?? d;

const AIRTABLE_PAT  = env("AIRTABLE_PAT");
const AIRTABLE_BASE = env("AIRTABLE_BASE_ID");
const TB_SPEDIZIONI = env("TB_SPEDIZIONI", "SpedizioniWebApp"); // tab: spedizioni
const TB_PL         = env("TB_PL", "SPED_PL");                  // tab: righe (packing list)

const DOCS_SIGN_SECRET  = env("DOCS_SIGN_SECRET");
const BYPASS_SIGNATURE  = env("BYPASS_SIGNATURE") === "1";

// Campo ESATTO (case sensitive) su Airtable
const FIELD_ID_SPED = "ID Spedizione";

/* ──────────────────────────────────────────────────────────────────────────
   UTILS
────────────────────────────────────────────────────────────────────────── */
const asJSON = (res, code, payload) => {
  res.status(code).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const fmtDate = (d) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
};
const eur = (n, cur = "EUR") =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: cur }).format(Number(n || 0));

const pick = (obj, names, fb = "") =>
  names.map((k) => obj?.[k]).find((v) => v !== undefined && v !== null && v !== "") ?? fb;

const field = (rec, names, fb = "") => pick(rec?.fields || {}, names, fb);

const hmac = (s) => crypto.createHmac("sha256", DOCS_SIGN_SECRET || "").update(s).digest("hex");
const stringToSign = ({ sid, type, exp }) => [sid, type, exp].filter(Boolean).join("|");

/* ──────────────────────────────────────────────────────────────────────────
   Airtable helpers
────────────────────────────────────────────────────────────────────────── */
const airHeaders = () => ({
  Authorization: `Bearer ${AIRTABLE_PAT}`,
});

const baseURL = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE)}`;
const tableURL = (table) => `${baseURL}/${encodeURIComponent(table)}`;
const recordURL = (table, recId) => `${tableURL(table)}/${encodeURIComponent(recId)}`;

async function airFetch(url) {
  const r = await fetch(url, { headers: airHeaders() });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`Airtable ${r.status}: ${text}`);
    err.status = r.status;
    err.body = text;
    err.url = url;
    throw err;
  }
  return JSON.parse(text);
}

// Spedizione: se sid è recXXXX usa endpoint record, altrimenti filtra per {ID Spedizione}='...'
async function airGetShipmentBySID(sid) {
  if (/^rec[a-zA-Z0-9]{14}/.test(String(sid))) {
    const url = recordURL(TB_SPEDIZIONI, sid);
    console.log("[render] GET record by recId", { url });
    return await airFetch(url);
  } else {
    const safe = String(sid || "").replace(/'/g, "\\'");
    const formula = `{${FIELD_ID_SPED}}='${safe}'`; // NOME CAMPO ESATTO!
    const qs = `filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
    const url = `${tableURL(TB_SPEDIZIONI)}?${qs}`;
    console.log("[render] GET by formula", { formula, url });
    const data = await airFetch(url);
    return data.records?.[0] || null;
  }
}

// Righe (packing list): filtra per {ID Spedizione}='...'
async function airGetPLRowsBySID(sid) {
  const safe = String(sid || "").replace(/'/g, "\\'");
  const formula = `{${FIELD_ID_SPED}}='${safe}'`;
  let url = `${tableURL(TB_PL)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
  console.log("[render] GET PL rows", { formula, url });

  const rows = [];
  while (url) {
    const r = await airFetch(url);
    rows.push(...(r.records || []));
    url = r.offset ? `${tableURL(TB_PL)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&offset=${r.offset}` : null;
  }
  return rows;
}

/* ──────────────────────────────────────────────────────────────────────────
   Template HTML (stampa/salva PDF da browser)
────────────────────────────────────────────────────────────────────────── */
function renderHTML({ doc, ship, receiver, items, totals, ui }) {
  const zebra = (i) => (i % 2 ? ' style="background:#fafafa"' : "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${ui.title}</title>
<style>
:root{
  --brand:#111827; --accent:#0ea5e9; --text:#0b0f13; --muted:#6b7280;
  --border:#e5e7eb; --border-strong:#d1d5db; --bg:#ffffff; --zebra:#fafafa; --chip:#f3f4f6;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;}
.page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative}
header{display:grid; grid-template-columns:1fr auto; gap:16px; align-items:start}
.brand .word{font-size:26px; font-weight:800; color:var(--brand)}
.brand .meta{margin-top:6px; font-size:12px; color:var(--muted)}
.tag{display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#374151; background:var(--chip); border:1px solid var(--border); padding:2px 6px; border-radius:6px; margin-bottom:6px}
.doc-meta{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:10px; padding:10px; min-width:260px}
.doc-meta .title{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); font-weight:800}
.doc-meta .kv div{margin:2px 0}
hr.sep{border:none;border-top:1px solid var(--border); margin:16px 0 18px}
.grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
.card{border:1px solid var(--border); border-radius:12px; padding:12px}
.card h3{margin:0 0 8px; font-size:11px; color:#374151; text-transform:uppercase; letter-spacing:.08em}
.small{font-size:12px; color:#374151}
table.items{width:100%; border-collapse:collapse; font-size:12px; margin-top:16px}
table.items th, table.items td{border-bottom:1px solid var(--border); padding:9px 8px; vertical-align:top}
table.items thead th{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#374151; text-align:left; background:var(--chip)}
table.items td.num, table.items th.num{text-align:right}
.totals{margin-top:10px; display:flex; justify-content:flex-end}
.totals table{font-size:12px; border-collapse:collapse; min-width:260px}
.totals td{padding:8px 10px; border-bottom:1px solid var(--border)}
.totals tr:last-child td{border-top:1px solid var(--border-strong); border-bottom:none; font-weight:700}
.sign{margin-top:20px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px}
.sign .box{height:64px; border:1px dashed var(--border-strong); border-radius:10px; width:260px}
.wm{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none}
.wm span{opacity:0.06; font-size:160px; letter-spacing:0.22em; transform:rotate(-24deg); font-weight:800; color:#0f172a}
.printbar{position:sticky; top:0; display:flex; gap:8px; justify-content:flex-end; padding:8px 0}
.btn{appearance:none; border:1px solid var(--border); background:#fff; padding:8px 12px; border-radius:10px; font-size:12px; cursor:pointer}
.btn.primary{border-color:#0ea5e9; background:#0ea5e9; color:#fff}
@media print{ .printbar{display:none} .page{box-shadow:none} }
</style>
</head>
<body>
  <div class="printbar">
    <button class="btn" onclick="window.open(location.href, '_blank')">Open preview</button>
    <button class="btn primary" onclick="window.print()">Print / Save PDF</button>
  </div>

  <div class="page">
    <div class="wm"><span>${ui.watermark}</span></div>

    <header>
      <div class="brand">
        <div class="tag">Sender</div>
        <div class="word">${doc.sender.name}</div>
        <div class="meta">
          ${doc.sender.address}<br/>
          ${doc.sender.contacts}
        </div>
      </div>
      <div class="doc-meta">
        <div class="title">Proforma Invoice</div>
        <div class="kv">
          <div><strong>No.:</strong> ${doc.number}</div>
          <div><strong>Date:</strong> ${doc.date}</div>
          <div><strong>Shipment ID:</strong> ${ship.id}</div>
        </div>
      </div>
    </header>

    <hr class="sep" />

    <section class="grid">
      <div class="card">
        <h3>Receiver</h3>
        <div class="small"><strong>${receiver.name || "—"}</strong></div>
        ${receiver.lines.map(l => `<div class="small">${l}</div>`).join("")}
        ${receiver.tax ? `<div class="small">Tax ID: ${receiver.tax}</div>` : ""}
        ${receiver.email || receiver.phone ? `<div class="small">${[receiver.email, receiver.phone].filter(Boolean).join(" · ")}</div>` : ""}
      </div>
      <div class="card">
        <h3>Shipment details</h3>
        ${ship.carrier ? `<div class="small">Carrier: ${ship.carrier}</div>` : ""}
        <div class="small">Incoterm: ${doc.incoterm || "—"} · Currency: ${doc.currency}</div>
        ${ship.pickup ? `<div class="small">Pickup date: ${ship.pickup}</div>` : ""}
      </div>
    </section>

    <table class="items" aria-label="Goods details">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Description</th>
          <th style="width:80px" class="num">Qty</th>
          <th style="width:120px" class="num">Price</th>
        </tr>
      </thead>
      <tbody>
        ${items.length ? items.map((it, i) => `
          <tr${zebra(i)}>
            <td>${i+1}</td>
            <td>
              <strong>${it.title}</strong><br/>
              ${it.meta ? `<span style="color:#6b7280">${it.meta}</span>` : ""}
            </td>
            <td class="num">${it.qty}</td>
            <td class="num">${it.unit}</td>
          </tr>
        `).join("") : `
          <tr${zebra(0)}>
            <td>1</td>
            <td><strong>—</strong></td>
            <td class="num">0</td>
            <td class="num">${eur(0)}</td>
          </tr>
        `}
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td style="text-align:right">Total</td><td style="text-align:right; width:140px"><strong>${totals.total}</strong></td></tr>
      </table>
    </div>

    <div style="margin-top:16px; font-size:12px; color:#374151">
      If you need more informations about this shipping you can check us at:<br/>
      <strong>info@spst.it</strong><br/>
      <strong>+39 320 144 1789</strong><br/>
      <strong>www.spst.it</strong>
    </div>

    <div class="sign">
      <div>
        <div class="small"><strong>Place & date:</strong> ${doc.place}, ${doc.date}</div>
        <div class="small">${doc.sender.contacts}</div>
      </div>
      <div>
        <div class="small" style="margin-bottom:6px">Signature</div>
        <div class="box"></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* ──────────────────────────────────────────────────────────────────────────
   API Handler
────────────────────────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  try {
    res.setHeader("cache-control", "no-store");

    const q = req.query || {};
    const sid = q.ship || q.sid;
    const type = q.type || "proforma";
    const exp  = q.exp;
    const sig  = q.sig;

    // Auth: HMAC (disattivabile con BYPASS_SIGNATURE=1)
    if (!BYPASS_SIGNATURE) {
      if (!DOCS_SIGN_SECRET) return asJSON(res, 500, { ok:false, error:"Missing DOCS_SIGN_SECRET" });
      if (!sid || !exp || !sig) return asJSON(res, 401, { ok:false, error:"Unauthorized", details:"Missing query params" });
      const now = Math.floor(Date.now() / 1000);
      if (Number(exp) < now) return asJSON(res, 401, { ok:false, error:"Unauthorized", details:"Expired" });
      const toSign = stringToSign({ sid, type, exp });
      const good = hmac(toSign);
      const okSig = crypto.timingSafeEqual(Buffer.from(good), Buffer.from(String(sig)));
      if (!okSig) return asJSON(res, 401, { ok:false, error:"Unauthorized", details:"Bad signature" });
    }

    if (!AIRTABLE_PAT || !AIRTABLE_BASE) {
      return asJSON(res, 500, { ok:false, error:"Airtable not configured" });
    }
    if (!sid) {
      return asJSON(res, 400, { ok:false, error:"Missing 'sid' (ID Spedizione)" });
    }

    // Spedizione
    let rec;
    try {
      rec = await airGetShipmentBySID(sid);
    } catch (e) {
      console.error("[render] airtable shipment error", { message: e.message, url: e.url, body: e.body });
      return asJSON(res, 500, { ok:false, error:"Render error", details:String(e.message) });
    }

    if (!rec) {
      return asJSON(res, 404, { ok:false, error:"Not found", details:`No shipment with {${FIELD_ID_SPED}}='${sid}'` });
    }

    const f = rec.fields || {};

    // DATE from "Ritiro - Data" (fallback now)
    const rawDate = pick(f, ["Ritiro - Data","Data ritiro","Pickup","Pickup Date","Data Proforma","Data"]);
    const dateObj = rawDate ? new Date(rawDate) : new Date();

    // Sender (mittente) from Airtable
    const senderName = pick(f, ["Mittente - Ragione Sociale"]);
    const senderCountry = pick(f, ["Mittente - Paese"]);
    const senderCity = pick(f, ["Mittente - Città"]);
    const senderCap = pick(f, ["Mittente - CAP"]);
    const senderAddr = pick(f, ["Mittente - Indirizzo"]);
    const senderPhone = pick(f, ["Mittente - Telefono"]);
    const senderVat = pick(f, ["Mittente - P.IVA/CF"]);

    const senderAddressLines = [
      [senderAddr, senderCap, senderCity].filter(Boolean).join(", "),
      senderCountry
    ].filter(Boolean).join(" · ");

    // Testata documento
    const doc = {
      kind: type,
      number: field(rec, ["Numero Proforma","Numero Documento","Doc No","Numero"], `PF-${sid}`),
      date:   fmtDate(dateObj),
      currency: field(rec, ["Valuta","Currency"], "EUR"),
      incoterm: field(rec, ["Incoterm","Termini resa"], ""),
      place:  senderCity || "—",
      sender: {
        name: senderName || "SPST S.r.l.",
        address: senderAddressLines || "Via Esempio 1, 20100 Milano (MI), Italy",
        contacts: [
          senderVat ? `VAT/Tax ID ${senderVat}` : "",
          senderPhone ? `Tel: ${senderPhone}` : ""
        ].filter(Boolean).join(" · ") || "info@spst.it · +39 320 144 1789 · www.spst.it",
      },
    };

    // Receiver
    const receiver = {
      name: pick(f, ["Destinatario - Ragione Sociale","Destinatario - Nome","Consignee","Cliente"], ""),
      lines: [
        pick(f, ["Destinatario - Indirizzo","Indirizzo destinatario"]),
        [pick(f, ["Destinatario - CAP","CAP"]), pick(f, ["Destinatario - Città","Città"]), pick(f, ["Destinatario - Provincia","Provincia"])].filter(Boolean).join(" "),
        pick(f, ["Destinatario - Paese","Paese"])
      ].filter(Boolean),
      tax:  pick(f, ["Destinatario - P.IVA","VAT","Tax ID","Destinatario - P.IVA/CF"]),
      email: pick(f, ["Destinatario - Email","Email destinatario"]),
      phone: pick(f, ["Destinatario - Telefono","Telefono destinatario"]),
    };

    // Spedizione (meta)
    const ship = {
      id: sid,
      carrier: pick(f, ["Carrier","Corriere","Vettore"]),
      pickup: rawDate ? fmtDate(new Date(rawDate)) : pick(f, ["Pickup"], ""),
    };

    // Righe da tabella SPED_PL
    let items = [];
    try {
      const rows = await airGetPLRowsBySID(sid);
      items = rows.map((r) => {
        const rf = r.fields || {};
        const qty = Number(pick(rf, ["Qta","Qtà","Quantità","Qty"], 0)) || 0;
        const up  = Number(pick(rf, ["Prezzo","Prezzo Unitario","Unit Price","Prezzo unitario","Price"], 0)) || 0;
        const metaParts = [];
        const hs = pick(rf, ["HS","HS Code","HS code","Codice HS"]);
        const org = pick(rf, ["Origine","Paese origine","Origine merce","Origin"]);
        const peso = pick(rf, ["Peso","Peso (kg)","Peso Kg","Weight"]);
        if (hs) metaParts.push(`HS: ${hs}`);
        if (org) metaParts.push(`Origin: ${org}`);
        if (peso) metaParts.push(`Weight: ${peso} kg`);
        return {
          title: pick(rf, ["Descrizione","Description","Prodotto","Articolo","Item","Item Description"], "—"),
          meta: metaParts.join(" · "),
          qty,
          unit: eur(up, doc.currency),
          _n: qty * up,
        };
      });
    } catch (e) {
      console.error("[render] airtable PL rows error", { message: e.message, url: e.url, body: e.body });
      items = [];
    }

    const total = items.reduce((s, it) => s + (it._n || 0), 0);

    // UI
    const ui = {
      title: "Proforma Invoice — Preview",
      watermark: "PROFORMA",
    };

    // Render
    const html = renderHTML({
      doc,
      ship,
      receiver,
      items,
      totals: { total: eur(total, doc.currency) },
      ui,
    });

    res.status(200).setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);

    console.log("[render] OK", { type, sid, tables: { TB_SPEDIZIONI, TB_PL }, field: FIELD_ID_SPED });
  } catch (err) {
    console.error("[render] ERR", err);
    return asJSON(res, 500, { ok:false, error:"Render error", details:String(err?.message || err) });
  }
}
