// api/docs/unified/render.js
export const config = { runtime: "nodejs", maxDuration: 60, memory: 512 };

import PDFDocument from "pdfkit";

// (Manteniamo il template HTML nel repo, ma qui usiamo PDFKit)
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

    // ping: nessun Airtable, nessun PDF
    if (String(stage) === "ping") {
      return res.status(200).json({
        ok: true,
        stage: "ping",
        env: { node: process.version, hasBase: !!BASE_ID, hasPat: !!PAT, table: TB }
      });
    }

    if (!shipmentId) return res.status(400).send("Missing shipmentId");

    // --- Fetch Airtable ---
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

    // --- Normalize payload ---
    const mode = type === "commercial" ? "commercial" : "proforma";
    const title = mode === "commercial" ? "Commercial Invoice" : "Proforma Invoice";
    const watermark = mode === "commercial" ? "COMMERCIAL" : "PROFORMA";

    const sender = {
      name: pick(["Mittente_Ragione", "Mittente", "Sender_Name", "Mittente Ragione Sociale"], "SPST S.r.l."),
      address: pick(["Mittente_Indirizzo", "Mittente Indirizzo", "Sender_Address"], "Via Esempio 1, 20100 Milano (MI), Italy"),
      city: pick(["Mittente_Citta", "Mittente Città", "Sender_City"], "Milan"),
      vat: pick(["Mittente_VAT", "P.IVA Mittente", "Mittente_PIVA", "Sender_VAT"], "IT12345678901"),
      email: pick(["Mittente_Email", "Email Mittente", "Sender_Email"], "info@spst.it"),
      phone: pick(["Mittente_Telefono", "Telefono Mittente", "Sender_Phone"], "+39 320 144 1789")
    };

    const consignee = {
      name: pick(["Ragione Sociale Destinatario Fattura", "Destinatario", "Consignee_Name"], "Consignee Ltd"),
      line1: (() => {
        const addr = pick(["Indirizzo Destinatario Fattura", "Indirizzo Destinatario", "Consignee_Address"], "Street 1");
        const cap = pick(["CAP Destinatario Fattura", "CAP Destinatario", "Consignee_Zip"], "");
        const city = pick(["Città Destinatario Fattura", "Città Destinatario", "Consignee_City"], "City");
        const ctry = pick(["Paese Destinatario", "Consignee_Country"], "DE");
        return [addr, [cap, city].filter(Boolean).join(" "), `(${ctry})`].filter(Boolean).join(", ");
      })(),
      taxId: pick(["Tax ID Destinatario", "Destinatario_Tax", "Consignee_Tax"], ""),
      email: pick(["Email Destinatario", "Consignee_Email"], ""),
      phone: pick(["Telefono Destinatario Fattura", "Consignee_Phone"], "")
    };

    const pickupDate = fmtDate(pick(["Ritiro - Data", "Ritiro – Data", "Data Ritiro", "PickupDate"], ""));
    const incoterm = pick(["Incoterm"], "DAP");
    const currency = pick(["Valuta", "Currency"], "EUR");
    const shipmentIdStr = pick(["ID Spedizione", "Shipment_ID"], json.id);

    let lines = [];
    const rawLines = pick(["Lines_JSON", "Lista Colli Ordinata", "Lista Colli"], "[]");
    try { lines = typeof rawLines === "string" ? JSON.parse(rawLines) : rawLines; } catch {}
    if (!Array.isArray(lines) || !lines.length) {
      const qty = Number(pick(["Qta Colli", "Qty"], 1));
      const totalVal = Number(pick(["Valore Totale EUR", "Total_Value"], 0));
      lines = [{
        description: pick(["Contenuto", "Descrizione Generica"], "Goods"),
        qty,
        unitPrice: qty ? totalVal / qty : 0,
        hs: pick(["HS Code", "HS"], ""),
        origin: "IT",
        weightKg: Number(pick(["Peso Totale Kg", "Peso"], 0))
      }];
    }
    lines = lines.map((r, i) => ({
      description: r.description || r.descrizione || r.nome || `Item ${i + 1}`,
      qty: Number(r.qty ?? r.quantita ?? 1),
      unitPrice: Number(r.unitPrice ?? r.prezzoUnit ?? r.valore ?? 0),
      hs: r.hs || r.hsCode || "",
      origin: r.origin || r.origine || "IT",
      weightKg: Number(r.weightKg ?? r.pesoKg ?? 0)
    }));
    const total = lines.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);

    const payload = {
      mode, title, watermark,
      sender, consignee,
      shipment: {
        id: shipmentIdStr,
        number: makeDocNumber(mode, json.id),
        issueDate: fmtDate(new Date()),
        pickupDate,
        incoterm,
        currency
      },
      lines,
      total
    };

    if (String(debug) === "1") {
      return res.status(200).json({ ok: true, stage: "normalized", payload });
    }

    // --- PDFKit rendering ---
    const doc = new PDFDocument({ size: "A4", margins: { top: 52, left: 46, right: 46, bottom: 56 } }); // ~18mm/16mm
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `inline; filename="${payload.shipment.number}.pdf"`);
      res.status(200).send(pdf);
    });

    // fonts: usiamo i core fonts PDF (Helvetica)
    const H = 12;                     // base font size
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Watermark
    doc.save()
      .fillColor("#0f172a")
      .opacity(0.06)
      .fontSize(90)
      .translate(doc.page.width/2, doc.page.height/2)
      .rotate(-24)
      .text(payload.watemark || payload.watermark, -250, -40, { width: 500, align: "center" })
      .restore()
      .opacity(1);

    // Header: Sender (sx) + Doc meta (dx)
    const startY = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151").text("Sender");
    doc.moveDown(0.2);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text(payload.sender.name);
    doc.font("Helvetica").fontSize(10).fillColor("#6b7280")
      .text(`${payload.sender.address} · VAT ${payload.sender.vat}`)
      .text(`${payload.sender.email} · ${payload.sender.phone}`);

    const rightX = doc.x + pageW - 260; // box a destra
    const saveY = startY;
    doc.save().rect(doc.page.margins.left + pageW - 260, saveY, 260, 70).strokeColor("#e5e7eb").lineWidth(0.5).stroke().restore();
    doc.save().fillColor("#0ea5e9").font("Helvetica-Bold").fontSize(11).text(payload.title, doc.page.margins.left + pageW - 250, saveY + 6, { width: 240, align: "right" }).restore();
    doc.font("Helvetica").fontSize(10).fillColor("#111")
      .text(`No.: ${payload.shipment.number}`, doc.page.margins.left + pageW - 250, saveY + 26, { width: 240, align: "right" })
      .text(`Date: ${payload.shipment.issueDate}`, doc.page.margins.left + pageW - 250, saveY + 40, { width: 240, align: "right" })
      .text(`Shipment ID: ${payload.shipment.id}`, doc.page.margins.left + pageW - 250, saveY + 54, { width: 240, align: "right" });

    doc.moveDown(1.2);
    drawHr(doc);

    // Cards: Consignee + Shipment Details (grid 2 colonne)
    const gridY = doc.y;
    const colW = (pageW - 12) / 2;
    // Consignee
    drawCard(doc, doc.page.margins.left, gridY, colW, 86, (d) => {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151").text("Consignee");
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text(payload.consignee.name);
      doc.font("Helvetica").fontSize(10).fillColor("#374151")
        .text(payload.consignee.line1)
        .text(`Tax ID: ${payload.consignee.taxId || "-"}`)
        .text(`Email: ${payload.consignee.email || "-"} · Tel: ${payload.consignee.phone || "-"}`);
    });
    // Shipment Details
    drawCard(doc, doc.page.margins.left + colW + 12, gridY, colW, 68, (d) => {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151").text("Shipment Details");
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(10).fillColor("#374151")
        .text(`Pickup date: ${payload.shipment.pickupDate || "-"}`)
        .text(`Incoterm: ${payload.shipment.incoterm} · Currency: ${payload.shipment.currency}`);
    });

    doc.moveDown(1);

    // Table header
    const tableStartY = doc.y + 6;
    const col = {
      idx:  0,
      desc: 28,
      qty:  pageW - (28 + 300),
      unit: pageW - (28 + 170),
      amt:  pageW - (28 + 40)
    };
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151");
    doc.text("#",   doc.page.margins.left + col.idx, tableStartY,  { width: 20, align: "left" });
    doc.text("Description", doc.page.margins.left + col.desc, tableStartY, { width: 300, align: "left" });
    doc.text("Qty",  doc.page.margins.left + col.qty,  tableStartY, { width: 60, align: "right" });
    doc.text("Unit Price", doc.page.margins.left + col.unit, tableStartY, { width: 100, align: "right" });
    doc.text("Amount", doc.page.margins.left + col.amt, tableStartY, { width: 100, align: "right" });
    drawHr(doc, tableStartY + 14);

    // Rows
    let y = tableStartY + 22;
    doc.font("Helvetica").fontSize(10).fillColor("#111");
    payload.lines.forEach((r, i) => {
      // page break semplice
      if (y > doc.page.height - doc.page.margins.bottom - 80) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.text(String(i + 1), doc.page.margins.left + col.idx, y, { width: 20, align: "left" });
      const desc = `${r.description}\nHS: ${r.hs || "-"} · Origin: ${r.origin || "-"} · Est. weight: ${n(r.weightKg)} kg`;
      doc.text(desc, doc.page.margins.left + col.desc, y, { width: 300 });
      doc.text(n(r.qty), doc.page.margins.left + col.qty, y, { width: 60, align: "right" });
      doc.text(m(r.unitPrice, payload.shipment.currency), doc.page.margins.left + col.unit, y, { width: 100, align: "right" });
      doc.text(m((r.qty || 0) * (r.unitPrice || 0), payload.shipment.currency), doc.page.margins.left + col.amt, y, { width: 100, align: "right" });

      y += 32;
      doc.moveTo(doc.page.margins.left, y - 8).lineTo(doc.page.margins.left + pageW, y - 8).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
    });

    // Totals
    if (y < doc.y) y = doc.y;
    doc.moveDown(0.6);
    const totalsX = doc.page.margins.left + pageW - 240;
    doc.font("Helvetica").fontSize(10).fillColor("#111").text("Subtotal", totalsX, y + 6, { width: 120, align: "right" });
    doc.font("Helvetica-Bold").fontSize(10).text(m(payload.total, payload.shipment.currency), totalsX + 122, y + 6, { width: 118, align: "right" });
    drawHr(doc, y + 26);

    // Footer declaration + signature
    doc.moveDown(1);
    doc.font("Helvetica").fontSize(9).fillColor("#374151")
      .text(`Declaration: This ${title.toLowerCase()} is issued for customs purposes only and does not constitute a tax invoice. The values shown are intended solely for determining customs value in accordance with applicable regulations.`);
    doc.moveDown(0.6);
    const sigY = doc.y + 6;
    doc.font("Helvetica").fontSize(10).fillColor("#111")
      .text(`Place & date: ${payload.sender.city}, ${payload.shipment.issueDate}`);
    // signature box (right)
    const boxW = 200, boxH = 60;
    const boxX = doc.page.margins.left + pageW - boxW;
    doc.font("Helvetica").fontSize(10).fillColor("#374151").text("Signature", boxX, sigY - 14);
    doc.rect(boxX, sigY, boxW, boxH).dash(3, { space: 3 }).strokeColor("#d1d5db").lineWidth(1).stroke().undash();

    doc.end();
  } catch (e) {
    console.error("unified/render error", e);
    return res.status(500).send("Internal Server Error");
  }
}

/* ---------- helpers ---------- */
function drawHr(doc, y) {
  const yy = y ?? doc.y + 6;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveTo(doc.page.margins.left, yy).lineTo(doc.page.margins.left + w, yy).strokeColor("#e5e7eb").lineWidth(1).stroke();
}

function fmtDate(d) {
  try {
    const dt = typeof d === "string" ? new Date(d) : d;
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  } catch { return ""; }
}
function m(n, cur = "EUR") {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(Number(n || 0)); }
  catch { return `€ ${Number(n || 0).toFixed(2)}`; }
}
function n(v) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? String(x) : "0";
}
function makeDocNumber(type, id) {
  const pref = type === "commercial" ? (process.env.DOCS_COMMERCIAL_PREFIX || "CI") : (process.env.DOCS_PROFORMA_PREFIX || "PF");
  return `${pref}-${id}`;
}
