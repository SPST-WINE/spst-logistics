// /api/docs/unified/render.js
export const config = { runtime: "nodejs" };

import crypto from "node:crypto";

/* ============ ENV ============ */
const env = (k, d) => process.env[k] ?? d;

const AIRTABLE_PAT  = env("AIRTABLE_PAT");
const AIRTABLE_BASE = env("AIRTABLE_BASE_ID");
const TB_SPEDIZIONI = env("TB_SPEDIZIONI", "SpedizioniWebApp");
const TB_PL         = env("TB_PL", "SPED_PL");

const DOCS_SIGN_SECRET = env("DOCS_SIGN_SECRET", "");
const BYPASS_SIGNATURE = env("BYPASS_SIGNATURE") === "1";

// Nome campo *esatto* per il filtro
const FIELD_ID_SPED = "ID Spedizione";

/* ============ UTILS ============ */
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

const hmacHex = (s) => crypto.createHmac("sha256", DOCS_SIGN_SECRET).update(s).digest("hex");
const strToSign = ({ sid, type, exp }) => [sid, type, exp].filter(Boolean).join("|");

const normalizeType = (t) => {
  const s = String(t || "").toLowerCase();
  if (s.includes("commercial") || s.includes("fattura")) return "commercial";
  return "proforma";
};

/* ============ Airtable ============ */
const airHeaders = () => ({ Authorization: `Bearer ${AIRTABLE_PAT}` });
const baseURL = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE)}`;
const tableURL = (t) => `${baseURL}/${encodeURIComponent(t)}`;
const recordURL = (t, id) => `${tableURL(t)}/${encodeURIComponent(id)}`;

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

async function getShipmentBySid(sid) {
  if (/^rec[a-zA-Z0-9]{14}/.test(String(sid))) {
    return airFetch(recordURL(TB_SPEDIZIONI, sid));
  }
  const safe = String(sid).replace(/'/g, "\\'");
  const formula = `{${FIELD_ID_SPED}}='${safe}'`;
  const url = `${tableURL(TB_SPEDIZIONI)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const data = await airFetch(url);
  return data.records?.[0] || null;
}

async function getPLRowsBySid(sid) {
  const safe = String(sid).replace(/'/g, "\\'");
  const formula = `{${FIELD_ID_SPED}}='${safe}'`;
  let url = `${tableURL(TB_PL)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
  const rows = [];
  while (url) {
    const r = await airFetch(url);
    rows.push(...(r.records || []));
    url = r.offset ? `${tableURL(TB_PL)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&offset=${r.offset}` : null;
  }
  return rows;
}

/* ============ HTML TEMPLATE (stampa) ============ */
function renderHTML({ ui, doc, ship, receiver, items, totals }) {
  const zebra = (i) => (i % 2 ? ' style="background:#fafafa"' : "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${ui.title}</title>
<style>
:root{--brand:#111827;--accent:#0ea5e9;--text:#0b0f13;--muted:#6b7280;--border:#e5e7eb;--border-strong:#d1d5db;--chip:#f3f4f6}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.page{width:210mm;min-height:297mm;margin:0 auto;padding:18mm 16mm;position:relative}
header{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start}
.tag{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#374151;background:var(--chip);border:1px solid var(--border);padding:2px 6px;border-radius:6px;margin-bottom:6px}
.brand .word{font-size:26px;font-weight:800;color:var(--brand)}
.brand .meta{margin-top:6px;font-size:12px;color:var(--muted)}
.doc-meta{text-align:right;font-size:12px;border:1px solid var(--border);border-radius:10px;padding:10px;min-width:260px}
.doc-meta .title{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:800}
.doc-meta .kv div{margin:2px 0}
hr.sep{border:none;border-top:1px solid var(--border);margin:16px 0 18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{border:1px solid var(--border);border-radius:12px;padding:12px}
.card h3{margin:0 0 8px;font-size:11px;color:#374151;text-transform:uppercase;letter-spacing:.08em}
.small{font-size:12px;color:#374151}
table.items{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}
table.items th,table.items td{border-bottom:1px solid var(--border);padding:9px 8px;vertical-align:top}
table.items thead th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#374151;text-align:left;background:var(--chip)}
table.items td.num,table.items th.num{text-align:right}
.totals{margin-top:10px;display:flex;justify-content:flex-end}
.totals table{font-size:12px;border-collapse:collapse;min-width:260px}
.totals td{padding:8px 10px;border-bottom:1px solid var(--border)}
.totals tr:last-child td{border-top:1px solid var(--border-strong);border-bottom:none;font-weight:700}
.notice{margin-top:12px;font-size:11px;color:#374151}
.sign{margin-top:20px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
.sign .box{height:64px;border:1px dashed var(--border-strong);border-radius:10px;width:260px}
.printbar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px 0}
.btn{appearance:none;border:1px solid var(--border);background:#fff;padding:8px 12px;border-radius:10px;font-size:12px;cursor:pointer}
.btn.primary{border-color:#0ea5e9;background:#0ea5e9;color:#fff}
.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.wm span{opacity:.06;font-size:160px;letter-spacing:.22em;transform:rotate(-24deg);font-weight:800;color:#0f172a}
@media print{.printbar{display:none}.page{box-shadow:none}}
</style>
</head>
<body>
  <div class="printbar">
    <button class="btn" onclick="window.open(location.href, '_blank')">Open preview</button>
    <button class="btn primary" onclick="window.print()">Print / Save PDF</button>
  </div>

  <div class="page">
    ${ui.watermark ? `<div class="wm"><span>${ui.watermark}</span></div>` : ""}

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
        <div class="title">${ui.docTitle}</div>
        <div class="kv">
          <div><strong>No.:</strong> ${doc.number}</div>
          <div><strong>Date:</strong> ${doc.date}</div>
          <div><strong>Shipment ID:</strong> ${ship.id}</div>
        </div>
      </div>
    </header>

    <hr class="sep"/>

    <section class="grid">
      <div class="card">
        <h3>Receiver</h3>
        <div class="small"><strong>${receiver.name || "—"}</strong></div>
        ${receiver.lines.map(l => `<div class="small">${l}</div>`).join("")}
        ${receiver.tax ? `<div class="small">Tax ID: ${receiver.tax}</div>`:""}
        ${receiver.email || receiver.phone ? `<div class="small">${[receiver.email, receiver.phone].filter(Boolean).join(" · ")}</div>`:""}
      </div>
      <div class="card">
        <h3>Shipment details</h3>
        ${ship.carrier ? `<div class="small">Carrier: ${ship.carrier}</div>`:""}
        <div class="small">Incoterm: ${doc.incoterm || "—"} · Currency: ${doc.currency}</div>
        ${ship.pickup ? `<div class="small">Pickup date: ${ship.pickup}</div>`:""}
      </div>
    </section>

    <table class="items" aria-label="Goods details">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Description</th>
          <th class="num" style="width:80px">Qty</th>
          <th class="num" style="width:120px">Price</th>
        </tr>
      </thead>
      <tbody>
        ${items.length ? items.map((it,i)=>`
          <tr${zebra(i)}>
            <td>${i+1}</td>
            <td><strong>${it.title}</strong>${it.meta ? `<br/><span style="color:#6b7280">${it.meta}</span>`:""}</td>
            <td class="num">${it.qty}</td>
            <td class="num">${it.unit}</td>
          </tr>
        `).join("") : `
          <tr${zebra(0)}><td>1</td><td><strong>—</strong></td><td class="num">0</td><td class="num">${eur(0)}</td></tr>
        `}
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td style="text-align:right">Total</td><td style="text-align:right;width:140px"><strong>${totals.total}</strong></td></tr>
      </table>
    </div>

    ${ui.notice ? `<div class="notice">${ui.notice}</div>` : ""}

    <div style="margin-top:16px;font-size:12px;color:#374151">
      If you need more informations about this shipping you can check us at:<br/>
      <strong>info@spst.it</strong><br/>
      <strong>+39 320 144 1789</strong><br/>
      <strong>www.spst.it</strong>
    </div>

    <div class="sign">
      <div>
        <div class="small"><strong>Place & date:</strong> ${doc.place}, ${doc.date}</div>
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

/* ============ HANDLER ============ */
export default async function handler(req, res) {
  try {
    res.setHeader("cache-control", "no-store");

    const q = req.query || {};
    const sidRaw = q.ship || q.sid;
    const kind = normalizeType(q.type || "proforma");
    const exp  = q.exp;
    const sig  = q.sig;

    // Signature (HMAC su "sid|type|exp") – disattivabile con BYPASS_SIGNATURE=1
    if (!BYPASS_SIGNATURE) {
      if (!DOCS_SIGN_SECRET) {
        res.status(500).json({ ok:false, error:"Missing DOCS_SIGN_SECRET" });
        return;
      }
      if (!sidRaw || !exp || !sig) {
        res.status(401).send("Unauthorized");
        return;
      }
      const now = Math.floor(Date.now()/1000);
      if (Number(exp) < now) {
        res.status(401).send("Unauthorized");
        return;
      }
      const expected = hmacHex(strToSign({ sid:sidRaw, type:kind, exp }));
      const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
      if (!ok) {
        res.status(401).send("Unauthorized");
        return;
      }
    }

    if (!AIRTABLE_PAT || !AIRTABLE_BASE) {
      res.status(500).json({ ok:false, error:"Airtable not configured" });
      return;
    }
    if (!sidRaw) {
      res.status(400).json({ ok:false, error:"Missing 'sid' (ID Spedizione)" });
      return;
    }

    // Record spedizione
    const rec = await getShipmentBySid(sidRaw);
    if (!rec) {
      res.status(404).json({ ok:false, error:"Not found", details:`No shipment with {${FIELD_ID_SPED}}='${sidRaw}'` });
      return;
    }
    const f = rec.fields || {};

    // Mittente (sender)
    const senderName   = pick(f, ["Mittente - Ragione Sociale"]);
    const senderCountry= pick(f, ["Mittente - Paese"]);
    const senderCity   = pick(f, ["Mittente - Città"]);
    const senderCap    = pick(f, ["Mittente - CAP"]);
    const senderAddr   = pick(f, ["Mittente - Indirizzo"]);
    const senderPhone  = pick(f, ["Mittente - Telefono"]);
    const senderVat    = pick(f, ["Mittente - P.IVA/CF"]);

    const senderAddress = [
      [senderAddr, senderCap, senderCity].filter(Boolean).join(", "),
      senderCountry
    ].filter(Boolean).join(" · ");

    const senderContacts = [
      senderVat ? `VAT/Tax ID ${senderVat}` : "",
      senderPhone ? `Tel: ${senderPhone}` : ""
    ].filter(Boolean).join(" · ") || "info@spst.it · +39 320 144 1789 · www.spst.it";

    // Date & meta
    const rawDate = pick(f, ["Ritiro - Data","Data ritiro","Pickup","Pickup Date","Data Proforma","Data"]);
    const dateObj = rawDate ? new Date(rawDate) : new Date();

    const docMeta = {
      sender: { name: senderName || "SPST S.r.l.", address: senderAddress || "Via Esempio 1, 20100 Milano (MI), Italy", contacts: senderContacts },
      place: senderCity || "—",
      date: fmtDate(dateObj),
      currency: pick(f, ["Valuta","Currency"], "EUR"),
      incoterm: pick(f, ["Incoterm","Termini resa"], ""),
      number: kind === "proforma"
        ? pick(f, ["Numero Proforma","Numero Documento","Doc No","Numero"], `PF-${sidRaw}`)
        : pick(f, ["Numero Fattura","Numero Commerciale","Numero Documento","Doc No","Numero"], `CI-${sidRaw}`)
    };

    // Receiver (destinatario)
    const receiver = {
      name: pick(f, ["Destinatario - Ragione Sociale"]),
      lines: [
        pick(f, ["Destinatario - Indirizzo"]),
        [pick(f, ["Destinatario - CAP"]), pick(f, ["Destinatario - Città"]), pick(f, ["Destinatario - Provincia"])].filter(Boolean).join(" "),
        pick(f, ["Destinatario - Paese"])
      ].filter(Boolean),
      tax: pick(f, ["Destinatario - P.IVA","Destinatario - P.IVA/CF","VAT","Tax ID"]),
      email: pick(f, ["Destinatario - Email"]),
      phone: pick(f, ["Destinatario - Telefono"])
    };

    // Shipment block
    const ship = {
      id: pick(f, [FIELD_ID_SPED], sidRaw),
      carrier: pick(f, ["Corriere","Carrier"]),
      pickup: rawDate ? fmtDate(new Date(rawDate)) : ""
    };

    // Righe (packing list)
    const pl = await getPLRowsBySid(ship.id);
    const items = pl.map(r => {
      const g = r.fields || {};
      const qty = Number(pick(g, ["Qtà","Qta","Quantità","Qty"], 0));
      const unitPrice = Number(pick(g, ["Prezzo","Prezzo Unitario","Price"], 0));
      const hs = pick(g, ["HS","HS Code","HS CODE"]);
      const origin = pick(g, ["Origine","Paese origine","Origin"]);
      return {
        title: pick(g, ["Descrizione","Description"], "—"),
        meta: [hs ? `HS: ${hs}` : "", origin ? `Origin: ${origin}` : ""].filter(Boolean).join(" · "),
        qty,
        unit: eur(unitPrice, docMeta.currency)
      };
    });

    // Totale (somma qty*price)
    const totalVal = pl.reduce((acc, r) => {
      const g = r.fields || {};
      const q = Number(pick(g, ["Qtà","Qta","Quantità","Qty"], 0));
      const p = Number(pick(g, ["Prezzo","Prezzo Unitario","Price"], 0));
      return acc + q * p;
    }, 0);

    // UI per proforma vs commercial
    const ui = (kind === "proforma")
      ? {
          title: `Proforma Invoice — ${ship.id}`,
          docTitle: "Proforma Invoice",
          watermark: "PROFORMA",
          notice: "Goods are not for resale. Declared values are for customs purposes only."
        }
      : {
          title: `Commercial Invoice — ${ship.id}`,
          docTitle: "Commercial Invoice",
          watermark: "",      // niente watermark
          notice: ""          // nessuna dicitura
        };

    const html = renderHTML({
      ui,
      doc: docMeta,
      ship,
      receiver,
      items,
      totals: { total: eur(totalVal, docMeta.currency) }
    });

    res.setHeader("content-type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (err) {
    console.error("[render] error", err);
    res.status(500).json({ ok:false, error:"Render error", details:String(err?.message || err) });
  }
}
