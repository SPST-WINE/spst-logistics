// api/docs/unified/render.js
// Node 20+ — niente puppeteer: HTML per preview/print + PDF placeholder lato server.
// Parametri: sid, type=proforma|fattura|dle, exp, sig, [format=html|pdf], [print=1], [dl=1], [id=<ID Spedizione>]

import crypto from "node:crypto";

const SECRET = process.env.DOCS_SIGNING_SECRET || process.env.ATTACH_SECRET;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TB_SPEDIZIONI = process.env.TB_SPEDIZIONI || "SpedizioniWebApp";
const TB_SPED_PL     = process.env.TB_SPED_PL     || "SPED_PL";

// --- helpers ---------------------------------------------------------------

function bad(res, code, msg, details) {
  res.status(code).json({ ok: false, error: msg, details });
}
function ok(res, data) {
  res.status(200).send(data);
}
function hmacHex(s) {
  return crypto.createHmac("sha256", SECRET).update(s).digest("hex");
}
function safeEq(a, b) {
  const A = Buffer.from(String(a), "utf8");
  const B = Buffer.from(String(b), "utf8");
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}
function pick(fields, ...names) {
  for (const n of names) {
    const v = fields?.[n];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}
function fmtMoney(v, curr="€") {
  const n = Number(v || 0);
  return curr + " " + n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Airtable fetchers (best-effort; se non configurati, renderemo placeholder)
async function atGetRecord(table, recId) {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${recId}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }});
  if (!r.ok) return null;
  return r.json();
}
async function atListByIds(table, ids=[]) {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !ids.length) return [];
  const formula = "OR(" + ids.map(id => `RECORD_ID()="${id}"`).join(",") + ")";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=50`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }});
  if (!r.ok) return [];
  const j = await r.json();
  return (j.records || []).map(x => x.fields || {});
}

function buildView({type, sid, humanId, shipment, items}) {
  // titoli
  const titleMap = {
    proforma: "Proforma Invoice",
    fattura:  "Commercial Invoice",
    dle:      "Dichiarazione libera esportazione",
  };
  const title = titleMap[type] || "Document";

  // meta di intestazione (best-effort)
  const corriere = pick(shipment, "Corriere", "Courier", "Carrier");
  const idSpedizione = humanId || pick(shipment, "ID Spedizione", "Id Spedizione", "Spedizione ID") || sid;

  // mappo righe (campi multipli) — nomi campo tolleranti
  const rows = (items || []).map((f, i) => ({
    idx: i+1,
    desc:    pick(f, "Descrizione", "Descrizione Articolo", "Item", "Articolo"),
    qty:     Number(pick(f, "Quantità", "Quantita", "Qty", "Qta")) || 0,
    unit:    Number(pick(f, "Prezzo Unitario", "Unit Price", "Prezzo")) || 0,
    hs:      pick(f, "HS", "HS Code", "Voce doganale"),
    origin:  pick(f, "Origine", "Paese Origine", "Origin"),
    weight:  pick(f, "Peso kg (stimato)", "Peso kg", "Peso", "Weight kg"),
  }));

  // calcolo totali se disponibili
  const total = rows.reduce((s, r) => s + (r.qty * r.unit), 0);

  return { title, type, idSpedizione, corriere, rows, total };
}

function renderHTML(view, autoPrint=false) {
  const now = new Date();
  const headerLines = [
    `Documento: ${esc(view.title)}`,
    `ID Spedizione: ${esc(view.idSpedizione)}`,
    view.corriere ? `Corriere: ${esc(view.corriere)}` : "",
    `Generato: ${now.toLocaleDateString("it-IT")} ${now.toLocaleTimeString("it-IT")}`,
  ].filter(Boolean);

  const rowsHtml = view.rows.length ? view.rows.map(r => `
      <tr>
        <td>${r.idx}</td>
        <td>
          <strong>${esc(r.desc)}</strong><br/>
          <span class="muted">HS: ${esc(r.hs)} ${r.origin ? "· Origine: " + esc(r.origin) : ""} ${r.weight ? "· Peso: " + esc(r.weight) + " kg" : ""}</span>
        </td>
        <td class="num">${r.qty}</td>
        <td class="num">${fmtMoney(r.unit)}</td>
        <td class="num">${fmtMoney(r.qty * r.unit)}</td>
      </tr>
  `).join("") : `
      <tr><td colspan="5" class="muted">Nessuna riga trovata. Completa la packing list in Airtable (tab <em>${esc(TB_SPED_PL)}</em>) o collega le righe alla spedizione.</td></tr>
  `;

  const maybeTotals = view.rows.length ? `
    <div class="totals">
      <table>
        <tr>
          <td style="text-align:right">Subtotale</td>
          <td style="text-align:right; width:140px"><strong>${fmtMoney(view.total)}</strong></td>
        </tr>
      </table>
    </div>
  ` : "";

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(view.title)} — Preview</title>
<style>
  :root{
    --brand:#111827; --accent:#0ea5e9; --text:#0b0f13; --muted:#6b7280;
    --border:#e5e7eb; --border-strong:#d1d5db; --bg:#ffffff; --zebra:#fafafa; --chip:#f3f4f6;
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative}
  header h1{margin:0 0 8px; font-size:22px; letter-spacing:.2px}
  .hdr small{display:block; color:#374151; margin-bottom:2px}
  .bubble{border:1px solid var(--border); padding:10px 12px; border-radius:10px; font-size:12px; color:#1f2937; background:#fbfdff}
  .muted{color:var(--muted)}
  .box{border:1px solid var(--border); border-radius:12px; padding:12px; background:#f6f9ff4d}
  table.items{width:100%; border-collapse:collapse; font-size:12px; margin-top:16px}
  table.items th, table.items td{border-bottom:1px solid var(--border); padding:9px 8px; vertical-align:top}
  table.items thead th{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#374151; text-align:left; background:var(--chip)}
  table.items td.num, table.items th.num{text-align:right}
  table.items tbody tr:nth-child(odd){background:var(--zebra)}
  table.items tbody tr:last-child td{border-bottom:1px solid var(--border-strong)}
  .totals{margin-top:10px; display:flex; justify-content:flex-end}
  .totals table{font-size:12px; border-collapse:collapse; min-width:260px}
  .totals td{padding:8px 10px; border-bottom:1px solid var(--border)}
  .totals tr:last-child td{border-top:1px solid var(--border-strong); border-bottom:none; font-weight:700}
  .print-btn{
    position:fixed; right:18px; top:16px; padding:10px 14px; border-radius:10px; border:1px solid #e5e7eb;
    background:linear-gradient(180deg,#ffffff,#f8fafc); box-shadow:0 6px 18px rgba(2,6,23,.08);
    font-weight:700; letter-spacing:.2px; cursor:pointer;
  }
  .print-btn:hover{filter:brightness(1.02)}
  @media print{ .print-btn{display:none} body{background:#fff} .page{box-shadow:none} }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨️ Stampa / Salva PDF</button>
<div class="page">
  <header class="hdr">
    <h1>SPST Logistics</h1>
    <div class="bubble">
      ${headerLines.map(l => `<small>${esc(l)}</small>`).join("")}
    </div>
  </header>

  <div class="box" style="margin-top:16px">
    <table class="items" aria-label="Dettaglio merci">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Descrizione</th>
          <th style="width:90px" class="num">Q.tà</th>
          <th style="width:120px" class="num">Prezzo</th>
          <th style="width:130px" class="num">Importo</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    ${maybeTotals}
  </div>
</div>
<script>
  (function(){
    try{
      var p = new URLSearchParams(location.search);
      if (p.get("print") === "1") {
        setTimeout(function(){ window.print(); }, 120);
      }
    }catch(e){}
  })();
</script>
</body>
</html>`;
}

function renderPDFPlaceholder(view) {
  // Genero un semplice PDF senza dipendenze esterne (header giusto, box placeholder).
  // In produzione puoi sostituire con pdf-lib come avevamo, oppure continuare a usare preview HTML.
  const lines = [
    "SPST Logistics",
    `Documento: ${view.title}`,
    `ID Spedizione: ${view.idSpedizione}`,
    view.corriere ? `Corriere: ${view.corriere}` : "",
    `Generato: ${new Date().toLocaleDateString("it-IT")}`,
    "",
    "Contenuti documento (placeholder)",
  ].filter(Boolean).join("\n");

  // PDF semplicissimo (one-page) — formato minimale
  const content = `%PDF-1.4
1 0 obj<<>>endobj
2 0 obj<< /Length 3 0 R >>stream
BT /F1 12 Tf 72 770 Td (${lines.replace(/([()\\])/g,'\\$1')}) Tj ET
endstream
endobj
3 0 obj  ${String(lines.length + 60)}
endobj
4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
5 0 obj<< /Type /Page /Parent 6 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 595 842] /Contents 2 0 R >>endobj
6 0 obj<< /Type /Pages /Kids [5 0 R] /Count 1 >>endobj
7 0 obj<< /Type /Catalog /Pages 6 0 R >>endobj
xref
0 8
0000000000 65535 f 
0000000010 00000 n 
0000000043 00000 n 
0000000214 00000 n 
0000000249 00000 n 
0000000328 00000 n 
0000000472 00000 n 
0000000531 00000 n 
trailer<< /Size 8 /Root 7 0 R >>
startxref
${571}
%%EOF`;

  return Buffer.from(content, "utf8");
}

// --- handler ----------------------------------------------------------------

export default async function handler(req, res) {
  try {
    const { sid, type="proforma", exp, sig, format, dl, id } = req.query || {};

    if (!sid || !exp || !sig || !SECRET) {
      return bad(res, 400, "Missing params");
    }
    const base = `${sid}.${type}.${exp}`;
    const check = hmacHex(base);
    if (!safeEq(sig, check)) {
      return bad(res, 401, "Unauthorized", "Invalid signature");
    }
    if (Date.now()/1000 > Number(exp)) {
      return bad(res, 401, "Link expired");
    }

    // Carico dati best-effort da Airtable
    let shipment = null, items = [];
    try {
      const rec = await atGetRecord(TB_SPEDIZIONI, sid);
      shipment = rec?.fields || null;

      // Cerco link a righe PL
      const linkIds = (shipment?.["SPED_PL"] || shipment?.["PL"] || shipment?.["Righe"] || []).filter(Boolean);
      if (linkIds.length) {
        items = await atListByIds(TB_SPED_PL, linkIds);
      }
    } catch (e) {
      // Non blocco il render se Airtable fallisce
      console.warn("[render] Airtable fallback:", e?.message);
    }

    const view = buildView({ type, sid, humanId: id, shipment, items });

    // HTML preview
    if ((format || "").toLowerCase() === "html") {
      const html = renderHTML(view);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (dl === "1") res.setHeader("Content-Disposition", "attachment; filename=\"preview.html\"");
      return ok(res, html);
    }

    // PDF placeholder (server)
    const pdf = renderPDFPlaceholder(view);
    res.setHeader("Content-Type", "application/pdf");
    if (dl === "1") res.setHeader("Content-Disposition", `attachment; filename="${type}-${sid}.pdf"`);
    return ok(res, pdf);
  } catch (err) {
    console.error("[render] 500", err);
    return bad(res, 500, "Render error", err?.message || String(err));
  }
}
