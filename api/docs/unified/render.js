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
    if (String(stage) === "ping") {
      return res.status(200).json({ ok: true, stage: "ping", env: { node: process.version, hasBase: !!BASE_ID, hasPat: !!PAT, table: TB } });
    }
    if (!shipmentId) return res.status(400).send("Missing shipmentId");

    // ------- Fetch Airtable -------
    const rec = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TB)}/${shipmentId}`, {
      headers: { Authorization: `Bearer ${PAT}` }
    });
    if (!rec.ok) {
      const txt = await rec.text().catch(() => "");
      return res.status(rec.status).send(`Airtable fetch failed: ${txt}`);
    }
    const json = await rec.json();
    const f = json.fields || {};
    const pick = (alts, d = "") => {
      const keys = Array.isArray(alts) ? alts : [alts];
      const k = keys.find(k => f[k] != null && f[k] !== "");
      return k ? f[k] : d;
    };

    // ------- Normalize -------
    const mode  = type === "commercial" ? "commercial" : "proforma";
    const title = mode === "commercial" ? "Commercial Invoice" : "Proforma Invoice";

    const sender = {
      name: pick(["Mittente_Ragione","Mittente","Sender_Name","Mittente Ragione Sociale"], "SPST S.r.l."),
      address: pick(["Mittente_Indirizzo","Mittente Indirizzo","Sender_Address"], "Via Esempio 1, 20100 Milano (MI), Italy"),
      city: pick(["Mittente_Citta","Mittente Città","Sender_City"], "Milan"),
      vat: pick(["Mittente_VAT","P.IVA Mittente","Mittente_PIVA","Sender_VAT"], "IT12345678901"),
      email: pick(["Mittente_Email","Email Mittente","Sender_Email"], "info@spst.it"),
      phone: pick(["Mittente_Telefono","Telefono Mittente","Sender_Phone"], "+39 320 144 1789")
    };
    const consignee = {
      name: pick(["Ragione Sociale Destinatario Fattura","Destinatario","Consignee_Name"], "Consignee Ltd"),
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
      lines = [{ description: pick(["Contenuto","Descrizione Generica"], "Goods"), qty, unitPrice: qty ? totalVal/qty : 0, hs: "", origin: "IT", weightKg: Number(pick(["Peso Totale Kg","Peso"], 0)) }];
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
      title,
      sender, consignee,
      shipment: { id: shipmentIdStr, number: makeDocNumber(mode, json.id), issueDate: fmtDate(new Date()), pickupDate, incoterm, currency },
      lines, total
    };

    if (String(debug) === "1") return res.status(200).json({ ok:true, stage:"normalized", payload });

    // ------- PDF (safe) -------
    const doc = new PDFDocument({ size: "A4", margins: { top: 52, left: 46, right: 46, bottom: 56 } });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("error", e => { console.error("pdfkit-error", e); try { res.status(500).send(`PDF error: ${e?.message || e}`); } catch {} });
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `inline; filename="${payload.shipment.number}.pdf"`);
      res.status(200).send(pdf);
    });

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Watermark semplice (senza translate/rounded)
    doc.save();
    doc.fillColor("#0f172a").opacity(0.06).fontSize(100);
    doc.rotate(-24, { origin: [doc.page.width/2, doc.page.height/2] });
    doc.text(mode === "commercial" ? "COMMERCIAL" : "PROFORMA", 0, doc.page.height/2 - 40, { width: doc.page.width, align: "center" });
    doc.restore().opacity(1);

    // Header
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text(payload.sender.name);
    doc.font("Helvetica").fontSize(10).fillColor("#6b7280")
      .text(`${payload.sender.address} · VAT ${payload.sender.vat}`)
      .text(`${payload.sender.email} · ${payload.sender.phone}`);

    // Doc meta (box a destra)
    const metaW = 260, metaH = 66, metaX = doc.page.margins.left + pageW - metaW, metaY = doc.page.margins.top;
    doc.rect(metaX, metaY, metaW, metaH).stroke("#e5e7eb");
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0ea5e9")
      .text(payload.title, metaX + 10, metaY + 8, { width: metaW - 20, align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor("#111")
      .text(`No.: ${payload.shipment.number}`,  metaX + 10, metaY + 26, { width: metaW - 20, align: "right" })
      .text(`Date: ${payload.shipment.issueDate}`, metaX + 10, metaY + 38, { width: metaW - 20, align: "right" })
      .text(`Shipment ID: ${payload.shipment.id}`, metaX + 10, metaY + 50, { width: metaW - 20, align: "right" });

    hr(doc);

    // Cards (rettangoli semplici)
    const colW = (pageW - 12)/2;
    const y0 = doc.y + 6;

    // Consignee
    doc.rect(doc.page.margins.left, y0, colW, 86).stroke("#e5e7eb");
    doc.save().translate(doc.page.margins.left + 8, y0 + 8);
    section(doc, "Consignee");
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text(consignee.name);
    doc.font("Helvetica").fontSize(10).fillColor("#374151")
      .text(consignee.line1)
      .text(`Tax ID: ${consignee.taxId || "-"}`)
      .text(`Email: ${consignee.email || "-"} · Tel: ${consignee.phone || "-"}`);
    doc.restore();

    // Shipment details
    const sx = doc.page.margins.left + colW + 12;
    doc.rect(sx, y0, colW, 66).stroke("#e5e7eb");
    doc.save().translate(sx + 8, y0 + 8);
    section(doc, "Shipment Details");
    doc.font("Helvetica").fontSize(10).fillColor("#374151")
      .text(`Pickup date: ${payload.shipment.pickupDate || "-"}`)
      .text(`Incoterm: ${payload.shipment.incoterm} · Currency: ${payload.shipment.currency}`);
    doc.restore();

    doc.moveDown(1);

    // Table header
    const thY = doc.y + 6;
    doc.save().rect(doc.page.margins.left, thY, pageW, 22).fill("#f3f4f6").restore();
    const cols = [
      { key: "#", w: 22, align: "left" },
      { key: "Description", w: pageW - (22 + 80 + 110 + 110), align: "left" },
      { key: "Qty", w: 80, align: "right" },
      { key: "Unit Price", w: 110, align: "right" },
      { key: "Amount", w: 110, align: "right" }
    ];
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151");
    let x = doc.page.margins.left;
    cols.forEach(c => { doc.text(c.key, x + 6, thY + 5, { width: c.w - 12, align: c.align }); x += c.w; });

    // Rows
    let y = thY + 24;
    const rowH = 28;
    doc.font("Helvetica").fontSize(10).fillColor("#111");
    lines.forEach((r, i) => {
      if (y > doc.page.height - doc.page.margins.bottom - 100) {
        doc.addPage();
        y = doc.page.margins.top;
        // repeat header
        doc.save().rect(doc.page.margins.left, y, pageW, 22).fill("#f3f4f6").restore();
        let xx = doc.page.margins.left;
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151");
        cols.forEach(c => { doc.text(c.key, xx + 6, y + 5, { width: c.w - 12, align: c.align }); xx += c.w; });
        y += 24;
        doc.font("Helvetica").fontSize(10).fillColor("#111");
      }
      if (i % 2 === 1) doc.save().rect(doc.page.margins.left, y - 2, pageW, rowH).fill("#FAFAFA").restore();

      let xx = doc.page.margins.left;
      doc.text(String(i+1), xx + 6, y + 4, { width: cols[0].w - 12, align: "left" }); xx += cols[0].w;

      const desc = `${r.description}\nHS: ${r.hs || "-"} · Origin: ${r.origin || "-"} · Est. weight: ${num(r.weightKg)} kg`;
      doc.text(desc, xx + 6, y + 4, { width: cols[1].w - 12, align: "left" }); xx += cols[1].w;

      doc.text(num(r.qty), xx + 6, y + 4, { width: cols[2].w - 12, align: "right" }); xx += cols[2].w;
      doc.text(money(r.unitPrice, currency), xx + 6, y + 4, { width: cols[3].w - 12, align: "right" }); xx += cols[3].w;
      doc.text(money((r.qty||0)*(r.unitPrice||0), currency), xx + 6, y + 4, { width: cols[4].w - 12, align: "right" });

      doc.moveTo(doc.page.margins.left, y + rowH).lineTo(doc.page.margins.left + pageW, y + rowH).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      y += rowH;
    });

    // Totals
    const totalsW = 240, totalsX = doc.page.margins.left + pageW - totalsW, totalsY = y + 8;
    doc.rect(totalsX, totalsY, totalsW, 40).stroke("#e5e7eb");
    doc.font("Helvetica").fontSize(10).fillColor("#111").text("Subtotal", totalsX + 10, totalsY + 10, { width: 110, align: "right" });
    doc.font("Helvetica-Bold").fontSize(11).text(money(total, currency), totalsX + 122, totalsY + 8, { width: totalsW - 132, align: "right" });

    // Declaration + firma
    doc.moveDown(1);
    doc.font("Helvetica").fontSize(9).fillColor("#374151")
      .text(`Declaration: This ${title.toLowerCase()} is issued for customs purposes only and does not constitute a tax invoice. The values shown are intended solely for determining customs value in accordance with applicable regulations.`);

    doc.moveDown(0.5);
    const sigY = doc.y + 6;
    doc.font("Helvetica").fontSize(10).fillColor("#111").text(`Place & date: ${sender.city}, ${payload.shipment.issueDate}`);
    const sW = 200, sH = 58, sX = doc.page.margins.left + pageW - sW;
    doc.font("Helvetica").fontSize(10).fillColor("#374151").text("Signature", sX, sigY - 14);
    doc.dash(3, { space: 3 }); doc.rect(sX, sigY, sW, sH).stroke("#d1d5db"); doc.undash();

    doc.end();
  } catch (e) {
    console.error("unified/render error", e);
    return res.status(500).send(`Internal Server Error: ${e?.message || e}`);
  }
}

/* -------- helpers -------- */
function hr(doc, y) {
  const yy = y ?? doc.y + 10;
  const w  = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveTo(doc.page.margins.left, yy).lineTo(doc.page.margins.left + w, yy).strokeColor("#e5e7eb").lineWidth(1).stroke();
}
function section(doc, t){ doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151").text(t.toUpperCase()); doc.moveDown(0.25); }
function fmtDate(d){ try{ const t=typeof d==="string"?new Date(d):d; return `${String(t.getDate()).padStart(2,"0")}-${String(t.getMonth()+1).padStart(2,"0")}-${t.getFullYear()}` }catch{ return "" } }
function num(v){ const x=Number(v||0); return Number.isFinite(x)?String(x):"0"; }
function money(n,cur="EUR"){ try{ return new Intl.NumberFormat("en-GB",{style:"currency",currency:cur}).format(Number(n||0)); }catch{ return `€ ${Number(n||0).toFixed(2)}`; } }
function makeDocNumber(type,id){ const pref = type==="commercial"?(process.env.DOCS_COMMERCIAL_PREFIX||"CI"):(process.env.DOCS_PROFORMA_PREFIX||"PF"); return `${pref}-${id}`; }
