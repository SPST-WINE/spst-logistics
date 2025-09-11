// api/docs/unified/render.js
export const config = { runtime: "nodejs", maxDuration: 60, memory: 512 };

import PDFDocument from "pdfkit";

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const PAT = process.env.AIRTABLE_PAT;
const TB = process.env.TB_SPEDIZIONI || "SpedizioniWebApp";
const SECRET = process.env.ATTACH_SECRET;

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).send("Method Not Allowed");
    }
    const { shipmentId, type = "proforma", token, debug, stage } = req.query;
    if (!token || token !== SECRET) return res.status(401).send("Unauthorized");

    // Ping ultraleggero (niente Airtable/PDF)
    if (String(stage) === "ping") {
      return res.status(200).json({
        ok: true, stage: "ping",
        env: { node: process.version, hasBase: !!BASE_ID, hasPat: !!PAT, table: TB }
      });
    }

    if (!shipmentId) return res.status(400).send("Missing shipmentId");

    // ---- Fetch Airtable ----
    const rec = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TB)}/${shipmentId}`,
      { headers: { Authorization: `Bearer ${PAT}` } }
    );
    if (!rec.ok) {
      const txt = await rec.text().catch(() => "");
      return res.status(rec.status).send(`Airtable fetch failed: ${txt}`);
    }
    const json = await rec.json();
    const f = json.fields || {};
    const pick = (alts, d = "") => {
      const keys = Array.isArray(alts) ? alts : [alts];
      const k = keys.find((k) => f[k] != null && f[k] !== "");
      return k ? f[k] : d;
    };

    // ---- Normalize ----
    const mode      = type === "commercial" ? "commercial" : "proforma";
    const title     = mode === "commercial" ? "Commercial Invoice" : "Proforma Invoice";
    const watermark = mode === "commercial" ? "COMMERCIAL" : "PROFORMA";

    const sender = {
      name: pick(["Mittente_Ragione","Mittente","Sender_Name","Mittente Ragione Sociale"], "SPST S.r.l."),
      address: pick(["Mittente_Indirizzo","Mittente Indirizzo","Sender_Address"], "Via Esempio 1, 20100 Milano (MI), Italy"),
      city: pick(["Mittente_Citta","Mittente Città","Sender_City"], "Milan"),
      vat: pick(["Mittente_VAT","P.IVA Mittente","Mittente_PIVA","Sender_VAT"], "IT12345678901"),
      email: pick(["Mittente_Email","Email Mittente","Sender_Email"], "info@spst.it"),
      phone: pick(["Mittente_Telefono","Telefono Mittente","Sender_Phone"], "+39 320 144 1789")
    };

    const consignee = {
      name:  pick(["Ragione Sociale Destinatario Fattura","Destinatario","Consignee_Name"], "Consignee Ltd"),
      line1: (() => {
        const addr = pick(["Indirizzo Destinatario Fattura","Indirizzo Destinatario","Consignee_Address"], "Street 1");
        const cap  = pick(["CAP Destinatario Fattura","CAP Destinatario","Consignee_Zip"], "");
        const city = pick(["Città Destinatario Fattura","Città Destinatario","Consignee_City"], "City");
        const ctry = pick(["Paese Destinatario","Consignee_Country"], "DE");
        return [addr, [cap, city].filter(Boolean).join(" "), `(${ctry})`].filter(Boolean).join(", ");
      })(),
      taxId: pick(["Tax ID Destinatario","Destinatario_Tax","Consignee_Tax"], ""),
      email: pick(["Email Destinatario","Consignee_Email"], ""),
      phone: pick(["Telefono Destinatario Fattura","Consignee_Phone"], "")
    };

    const pickupDate    = fmtDate(pick(["Ritiro - Data","Ritiro – Data","Data Ritiro","PickupDate"], ""));
    const incoterm      = pick(["Incoterm"], "DAP");
    const currency      = pick(["Valuta","Currency"], "EUR");
    const shipmentIdStr = pick(["ID Spedizione","Shipment_ID"], json.id);

    let lines = [];
    const rawLines = pick(["Lines_JSON","Lista Colli Ordinata","Lista Colli"], "[]");
    try { lines = typeof rawLines === "string" ? JSON.parse(rawLines) : rawLines; } catch {}
    if (!Array.isArray(lines) || !lines.length) {
      const qty = Number(pick(["Qta Colli","Qty"], 1));
      const totalVal = Number(pick(["Valore Totale EUR","Total_Value"], 0));
      lines = [{
        description: pick(["Contenuto","Descrizione Generica"], "Goods"),
        qty,
        unitPrice: qty ? totalVal/qty : 0,
        hs: pick(["HS Code","HS"], ""),
        origin: "IT",
        weightKg: Number(pick(["Peso Totale Kg","Peso"], 0))
      }];
    }
    lines = lines.map((r,i)=>({
      description: r.description || r.descrizione || r.nome || `Item ${i+1}`,
      qty: Number(r.qty ?? r.quantita ?? 1),
      unitPrice: Number(r.unitPrice ?? r.prezzoUnit ?? r.valore ?? 0),
      hs: r.hs || r.hsCode || "",
      origin: r.origin || r.origine || "IT",
      weightKg: Number(r.weightKg ?? r.pesoKg ?? 0)
    }));
    const total = lines.reduce((s,r)=> s + (Number(r.qty)||0) * (Number(r.unitPrice)||0), 0);

    const payload = {
      mode, title, watermark,
      sender, consignee,
      shipment: { id: shipmentIdStr, number: makeDocNumber(mode, json.id), issueDate: fmtDate(new Date()), pickupDate, incoterm, currency },
      lines, total
    };

    if (String(debug) === "1") return res.status(200).json({ ok:true, stage:"normalized", payload });

    // ====== PDF ======
    const doc = new PDFDocument({ size: "A4", margins: { top: 52, left: 46, right: 46, bottom: 56 } });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("error", err => {
      console.error("pdfkit-error", err);
      try { res.status(500).send(`PDF error: ${err?.message || err}`); } catch {}
    });
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `inline; filename="${payload.shipment.number}.pdf"`);
      res.status(200).send(pdf);
    });

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Page numbers
    let pageNo = 1;
    const drawFooter = () => {
      const y = doc.page.height - doc.page.margins.bottom + 24;
      doc.font("Helvetica").fontSize(9).fillColor("#9CA3AF")
        .text(`Page ${pageNo}`, doc.page.margins.left, y, { width: pageW, align: "center" });
    };
    doc.on("pageAdded", () => { pageNo += 1; drawFooter(); });

    // Watermark
    doc.save()
      .fillColor("#0f172a").opacity(0.06).fontSize(110)
      .translate(doc.page.width/2, doc.page.height/2).rotate(-24)
      .text(payload.watermark, -280, -40, { width: 560, align: "center" })
      .restore().opacity(1);

    // Header
    const headerY = doc.y;
    chipSafe(doc, "Sender", doc.page.margins.left, headerY, "#f3f4f6", "#e5e7eb");
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text(payload.sender.name, doc.page.margins.left, headerY + 18);
    doc.font("Helvetica").fontSize(10).fillColor("#6b7280")
      .text(`${payload.sender.address} · VAT ${payload.sender.vat}`)
      .text(`${payload.sender.email} · ${payload.sender.phone}`);

    // Doc meta (card destra)
    const metaW = 280, metaH = 78, metaX = doc.page.margins.left + pageW - metaW, metaY = headerY;
    roundedStroke(doc, metaX, metaY, metaW, metaH, 10, "#e5e7eb", 0.8);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0ea5e9")
      .text(title.toUpperCase(), metaX + 12, metaY + 8, { width: metaW - 24, align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor("#111")
      .text(`No.: ${payload.shipment.number}`,  metaX + 12, metaY + 28, { width: metaW - 24, align: "right" })
      .text(`Date: ${payload.shipment.issueDate}`, metaX + 12, metaY + 42, { width: metaW - 24, align: "right" })
      .text(`Shipment ID: ${payload.shipment.id}`, metaX + 12, metaY + 56, { width: metaW - 24, align: "right" });

    doc.moveDown(1.2); hr(doc);

    // Cards
    const gridY = doc.y;
    const colW = (pageW - 12)/2;

    cardSafe(doc, doc.page.margins.left, gridY, colW, 92, () => {
      sectionTitle(doc, "Consignee");
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text(consignee.name);
      doc.font("Helvetica").fontSize(10).fillColor("#374151")
        .text(consignee.line1)
        .text(`Tax ID: ${consignee.taxId || "-"}`)
        .text(`Email: ${consignee.email || "-"} · Tel: ${consignee.phone || "-"}`);
    });

    cardSafe(doc, doc.page.margins.left + colW + 12, gridY, colW, 72, () => {
      sectionTitle(doc, "Shipment Details");
      doc.font("Helvetica").fontSize(10).fillColor("#374151")
        .text(`Pickup date: ${payload.shipment.pickupDate || "-"}`)
        .text(`Incoterm: ${payload.shipment.incoterm} · Currency: ${payload.shipment.currency}`);
    });

    doc.moveDown(0.8);

    // Table header
    const thY = doc.y + 6;
    const cols = [
      { key: "#",   w: 22,  align: "left"  },
      { key: "Description", w: pageW - (22 + 80 + 110 + 110), align: "left" },
      { key: "Qty", w: 80,  align: "right" },
      { key: "Unit Price",  w: 110, align: "right" },
      { key: "Amount",      w: 110, align: "right" }
    ];
    doc.save().rect(doc.page.margins.left, thY, pageW, 24).fill("#f3f4f6").restore();
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151");
    let x = doc.page.margins.left;
    cols.forEach(c => { doc.text(c.key, x + 6, thY + 6, { width: c.w - 12, align: c.align }); x += c.w; });

    // Rows
    let y = thY + 26;
    const rowH = 30;
    lines.forEach((r, i) => {
      if (y > doc.page.height - doc.page.margins.bottom - 110) {
        drawFooter(); doc.addPage(); y = doc.page.margins.top;
        doc.save().rect(doc.page.margins.left, y, pageW, 24).fill("#f3f4f6").restore();
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151");
        let xx = doc.page.margins.left;
        cols.forEach(c => { doc.text(c.key, xx + 6, y + 6, { width: c.w - 12, align: c.align }); xx += c.w; });
        y += 26;
      }
      if (i % 2 === 1) doc.save().rect(doc.page.margins.left, y - 2, pageW, rowH).fill("#FAFAFA").restore();

      let xx = doc.page.margins.left;
      doc.font("Helvetica").fontSize(10).fillColor("#111")
        .text(String(i+1), xx + 6, y + 4, { width: cols[0].w - 12, align: "left" });
      xx += cols[0].w;

      const desc = `${r.description}\nHS: ${r.hs || "-"} · Origin: ${r.origin || "-"} · Est. weight: ${num(r.weightKg)} kg`;
      doc.text(desc, xx + 6, y + 4, { width: cols[1].w - 12, align: "left" });
      xx += cols[1].w;

      doc.text(num(r.qty), xx + 6, y + 4, { width: cols[2].w - 12, align: "right" }); xx += cols[2].w;
      doc.text(money(r.unitPrice, currency), xx + 6, y + 4, { width: cols[3].w - 12, align: "right" }); xx += cols[3].w;
      doc.text(money((r.qty||0)*(r.unitPrice||0), currency), xx + 6, y + 4, { width: cols[4].w - 12, align: "right" });

      doc.moveTo(doc.page.margins.left, y + rowH).lineTo(doc.page.margins.left + pageW, y + rowH)
        .strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      y += rowH;
    });

    // Totals
    const totalsW = 260, totalsX = doc.page.margins.left + pageW - totalsW, totalsY = y + 8;
    doc.roundedRect(totalsX, totalsY, totalsW, 46, 10).stroke("#e5e7eb");
    doc.font("Helvetica").fontSize(10).fillColor("#111")
      .text("Subtotal", totalsX + 12, totalsY + 12, { width: 120, align: "right" });
    doc.font("Helvetica-Bold").fontSize(11)
      .text(money(total, currency), totalsX + 136, totalsY + 10, { width: totalsW - 148, align: "right" });

    // Declaration + firma
    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(9).fillColor("#374151")
      .text(`Declaration: This ${title.toLowerCase()} is issued for customs purposes only and does not constitute a tax invoice. The values shown are intended solely for determining customs value in accordance with applicable regulations.`);

    doc.moveDown(0.6);
    const sigY = doc.y + 6;
    doc.font("Helvetica").fontSize(10).fillColor("#111")
      .text(`Place & date: ${sender.city}, ${payload.shipment.issueDate}`);
    const sBoxW = 200, sBoxH = 62, sBoxX = doc.page.margins.left + pageW - sBoxW;
    // label + box firma
    doc.font("Helvetica").fontSize(10).fillColor("#374151").text("Signature", sBoxX, sigY - 14);
    doc.dash(3, { space: 3 }); doc.roundedRect(sBoxX, sigY, sBoxW, sBoxH, 8).stroke("#d1d5db"); doc.undash();

    drawFooter();
    doc.end();
  } catch (e) {
    console.error("unified/render error", e);
    return res.status(500).send(`Internal Server Error: ${e?.message || e}`);
  }
}

/* -------- helpers (safe) -------- */
function hr(doc, y) {
  const yy = y ?? doc.y + 6;
  const w  = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveTo(doc.page.margins.left, yy).lineTo(doc.page.margins.left + w, yy)
    .strokeColor("#e5e7eb").lineWidth(1).stroke();
}
function sectionTitle(doc, t) { doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151").text(t.toUpperCase()); doc.moveDown(0.25); }
function roundedStroke(doc, x, y, w, h, r, color="#e5e7eb", lw=1) {
  doc.save(); doc.lineWidth(lw).strokeColor(color); doc.roundedRect(x, y, w, h, r).stroke(); doc.restore();
}
function cardSafe(doc, x, y, w, h, draw) { roundedStroke(doc, x, y, w, h, 10); doc.save(); doc.translate(x+10, y+8); draw(); doc.restore(); }
function chipSafe(doc, text, x, y, bg="#f3f4f6", stroke="#e5e7eb") {
  doc.font("Helvetica").fontSize(9);
  const padX=6, padY=2;
  const width = doc.widthOfString(text.toUpperCase()) + padX*2;
  const height= doc.currentLineHeight() + padY*2;
  // fill
  doc.save(); doc.fillColor(bg); doc.roundedRect(x, y, width, height, 6).fill(); doc.restore();
  // stroke
  doc.save(); doc.strokeColor(stroke); doc.roundedRect(x, y, width, height, 6).stroke(); doc.restore();
  // text
  doc.fillColor("#374151").text(text.toUpperCase(), x + padX, y + padY);
  doc.fillColor("#111");
}
function fmtDate(d){ try{ const t=typeof d==="string"?new Date(d):d; return `${String(t.getDate()).padStart(2,"0")}-${String(t.getMonth()+1).padStart(2,"0")}-${t.getFullYear()}` }catch{ return "" } }
function num(v){ const x = Number(v || 0); return Number.isFinite(x) ? String(x) : "0"; }
function money(n, cur="EUR"){ try{ return new Intl.NumberFormat("en-GB",{style:"currency",currency:cur}).format(Number(n||0)); }catch{ return `€ ${Number(n||0).toFixed(2)}`; } }
function makeDocNumber(type, id){ const pref = type==="commercial"?(process.env.DOCS_COMMERCIAL_PREFIX||"CI"):(process.env.DOCS_PROFORMA_PREFIX||"PF"); return `${pref}-${id}`; }
