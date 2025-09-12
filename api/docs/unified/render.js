// /api/docs/unified/render.js
// Runtime: Node.js 20+ (ESM). Nessun puppeteer: output HTML pronto per Stampa/Salva PDF.
export const config = { runtime: "nodejs" };

import crypto from "node:crypto";

/* =======================
   Env & helpers
======================= */
const env = (k, d) => process.env[k] ?? d;

const AIR_PAT  = env("AIRTABLE_PAT");
const AIR_BASE = env("AIRTABLE_BASE_ID");
const TB_SHIP  = env("TB_SPEDIZIONI", "SpedizioniWebApp");

const SIGN_SECRET   = env("DOCS_SIGN_SECRET");   // <— nuovo nome
const BYPASS_SIG    = env("BYPASS_SIGNATURE") === "1";

const asJSON = (res, code, payload) => {
  res.status(code).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const fmtDate = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const eur = (n, cur = "EUR") =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: cur }).format(Number(n || 0));

const pick = (obj, candidates, fallback = "") =>
  candidates
    .map((k) => obj?.[k])
    .find((v) => v !== undefined && v !== null && v !== "") ?? fallback;

const field = (rec, names, fb = "") => pick(rec?.fields || {}, names, fb);

const hmac = (s) => crypto.createHmac("sha256", SIGN_SECRET || "").update(s).digest("hex");
const stringToSign = ({ sid, type, exp, ship }) => [sid, type, exp, ship].filter(Boolean).join("|");

/* =======================
   Airtable minimal client
======================= */
const airHeaders = () => ({
  Authorization: `Bearer ${AIR_PAT}`,
});

const airURL = (table, qs) =>
  `https://api.airtable.com/v0/${encodeURIComponent(AIR_BASE)}/${encodeURIComponent(table)}${qs ? `?${qs}` : ""}`;

async function airFindShipmentBySid(idSpedizione) {
  const safe = String(idSpedizione || "").replace(/'/g, "\\'");
  const filter = encodeURIComponent(`{idSpedizione}='${safe}'`);
  const url = airURL(TB_SHIP, `filterByFormula=${filter}&maxRecords=1`);
  const r = await fetch(url, { headers: airHeaders() });
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.records?.[0] || null;
}

/* =======================
   Template HTML
======================= */
function renderHTML({ doc, ship, consignee, items, totals, ui }) {
  const today = fmtDate(new Date());
  const zebra = (i) => (i % 2 ? ' style="background:#fafafa"' : "");

  return `<!doctype html>
<html lang="it">
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
    <button class="btn" onclick="window.open(location.href.replace(/([?&])format=html(&|$)/,'$1').replace(/[?&]$/,''), '_blank')">Apri versione HTML “pura”</button>
    <button class="btn primary" onclick="window.print()">Stampa / Salva PDF</button>
  </div>

  <div class="page">
    <div class="wm"><span>${ui.watermark}</span></div>

    <header>
      <div class="brand">
        <div class="tag">Mittente</div>
        <div class="word">${doc.sender.name}</div>
        <div class="meta">${doc.sender.address}<br/>${doc.sender.contacts}</div>
      </div>
      <div class="doc-meta">
        <div class="title">${ui.headerTitle}</div>
        <div class="kv">
          <div><strong>No.:</strong> ${doc.number}</div>
          <div><strong>Data:</strong> ${doc.date || fmtDate(new Date())}</div>
          <div><strong>ID Spedizione:</strong> ${ship.id}</div>
        </div>
      </div>
    </header>

    <hr class="sep" />

    <section class="grid">
      <div class="card">
        <h3>Destinatario</h3>
        <div class="small"><strong>${consignee.name || "—"}</strong></div>
        ${consignee.lines.map(l => `<div class="small">${l}</div>`).join("")}
        ${consignee.tax ? `<div class="small">Tax ID: ${consignee.tax}</div>` : ""}
        ${consignee.email || consignee.phone ? `<div class="small">${[consignee.email, consignee.phone].filter(Boolean).join(" · ")}</div>` : ""}
      </div>
      <div class="card">
        <h3>Dettagli spedizione</h3>
        <div class="small">Corriere: ${ship.carrier || "—"}</div>
        <div class="small">Incoterm: ${doc.incoterm || "—"} · Valuta: ${doc.currency}</div>
        ${ship.pickup ? `<div class="small">Pickup: ${ship.pickup}</div>` : ""}
      </div>
    </section>

    <table class="items" aria-label="Dettaglio beni">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Descrizione</th>
          <th style="width:80px" class="num">Qtà</th>
          <th style="width:120px" class="num">Prezzo</th>
          <th style="width:130px" class="num">Importo</th>
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
            <td class="num">${it.amount}</td>
          </tr>
        `).join("") : `
          <tr${zebra(0)}>
            <td>1</td>
            <td><strong>Placeholder riga</strong><br/><span style="color:#6b7280">HS: 0000.00 · Origine: IT</span></td>
            <td class="num">1</td>
            <td class="num">${eur(0)}</td>
            <td class="num">${eur(0)}</td>
          </tr>
        `}
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td style="text-align:right">Totale</td><td style="text-align:right; width:140px"><strong>${totals.total}</strong></td></tr>
      </table>
    </div>

    <div class="sign">
      <div>
        <div class="small"><strong>Luogo & data:</strong> ${doc.place}, ${doc.date || fmtDate(new Date())}</div>
        <div class="small">${doc.sender.contacts}</div>
      </div>
      <div>
        <div class="small" style="margin-bottom:6px">Firma</div>
        <div class="box"></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* =======================
   Handler
======================= */
export default async function handler(req, res) {
  try {
    res.setHeader("cache-control", "no-store");

    const { sid, type = "proforma", exp, sig, ship: sid2 } = req.query || {};

    // --- Signature check (disattivabile in preview) ---
    if (!BYPASS_SIG) {
      if (!SIGN_SECRET) return asJSON(res, 500, { ok:false, error:"Missing DOCS_SIGN_SECRET" });
      if (!sid || !exp || !sig) return asJSON(res, 401, { ok:false, error:"Unauthorized", details:"Missing query params" });

      const now = Math.floor(Date.now() / 1000);
      if (Number(exp) < now) return asJSON(res, 401, { ok:false, error:"Unauthorized", details:"Expired" });

      const str = stringToSign({ sid, type, exp, ship: sid2 });
      const good = hmac(str);
      const safeEqual = crypto.timingSafeEqual(Buffer.from(good), Buffer.from(String(sig)));
      if (!safeEqual) return asJSON(res, 401, { ok:false, error:"Unauthorized", details:"Bad signature" });
    }

    // --- Airtable fetch ---
    if (!AIR_PAT || !AIR_BASE) {
      return asJSON(res, 500, { ok:false, error:"Airtable not configured" });
    }
    const rec = await airFindShipmentBySid(sid2 || sid);
    if (!rec) {
      return asJSON(res, 404, { ok:false, error:"Not found", details:`No shipment for idSpedizione='${sid2 || sid}'` });
    }
    const f = rec.fields || {};

    // --- Header/Doc fields (mapping tollerante) ---
    const doc = {
      kind: type,
      number: field(rec, ["Numero Proforma","Numero Documento","Doc No","Numero"], `PF-${(sid2 || sid)}`),
      date:   field(rec, ["Data Proforma","Data Documento","Data"], fmtDate(new Date())),
      currency: field(rec, ["Valuta","Currency"], "EUR"),
      incoterm: field(rec, ["Incoterm","Termini resa"], ""),
      place:  field(rec, ["Luogo","Luogo emissione"], "Milano"),
      sender: {
        name: "SPST S.r.l.",
        address: "Via Esempio 1, 20100 Milano (MI), Italy · VAT IT12345678901",
        contacts: "info@spst.it · +39 320 144 1789 · www.spst.it",
      },
    };

    const consignee = {
      name: pick(f, ["Destinatario - Nome","Destinatario","Consignee","Cliente"], "—"),
      lines: [
        pick(f, ["Destinatario - Indirizzo","Indirizzo destinatario"]),
        [pick(f, ["Destinatario - CAP","CAP"]), pick(f, ["Destinatario - Città","Città"]), pick(f, ["Destinatario - Provincia","Provincia"])].filter(Boolean).join(" "),
        pick(f, ["Destinatario - Paese","Paese"])
      ].filter(Boolean),
      tax:  pick(f, ["Destinatario - P.IVA","VAT","Tax ID"]),
      email: pick(f, ["Destinatario - Email","Email destinatario"]),
      phone: pick(f, ["Destinatario - Telefono","Telefono destinatario"]),
    };

    const ship = {
      id: sid2 || sid,
      carrier: pick(f, ["Corriere","Vettore"]),
      pickup: pick(f, ["Data ritiro","Pickup"]),
    };

    // --- Righe: supporto JSON in campo testo (facoltativo) ---
    // Se hai un campo come "Righe JSON" / "Items JSON" con array di oggetti:
    // [{descrizione, qty, prezzo, hs, origine, peso}]
    let items = [];
    const rowsJSON = pick(f, ["Righe JSON","Items JSON","Proforma - Righe JSON"]);
    if (rowsJSON) {
      try {
        const arr = JSON.parse(rowsJSON);
        if (Array.isArray(arr)) {
          items = arr.map((r) => {
            const qty = Number(r.qty || r.quantita || 0) || 0;
            const up  = Number(r.prezzo || r.unitPrice || 0) || 0;
            const metaParts = [];
            if (r.hs) metaParts.push(`HS: ${r.hs}`);
            if (r.origine) metaParts.push(`Origine: ${r.origine}`);
            if (r.peso) metaParts.push(`Peso: ${r.peso} kg`);
            return {
              title: r.descrizione || r.description || "—",
              meta: metaParts.join(" · "),
              qty,
              unit: eur(up, doc.currency),
              amount: eur(qty * up, doc.currency),
              _n: qty * up,
            };
          });
        }
      } catch (e) {
        console.warn("[render] Righe JSON parse error:", e?.message || e);
      }
    }

    // Totali
    const total = items.reduce((s, it) => s + (it._n || 0), 0);

    // UI labels
    const ui = {
      title: "Proforma Invoice — Anteprima",
      headerTitle: "Proforma Invoice",
      watermark: "PROFORMA",
    };

    const html = renderHTML({
      doc,
      ship,
      consignee,
      items,
      totals: { total: eur(total, doc.currency) },
      ui,
    });

    // OK
    res.status(200).setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);

    // Log sintetico
    console.log("[render] OK", {
      type,
      sid: sid2 || sid,
      table: TB_SHIP,
    });
  } catch (err) {
    console.error("[render] ERR", err);
    return asJSON(res, 500, { ok:false, error:"Render error", details:String(err?.message || err) });
  }
}
