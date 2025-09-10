export const config = { runtime: "nodejs" };

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { renderUnifiedHTML } from "./template.js";

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const PAT = process.env.AIRTABLE_PAT;
const TB = process.env.TB_SPEDIZIONI || "Spedizioni";
const SECRET = process.env.ATTACH_SECRET;

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).send("Method Not Allowed");
    }

    const { shipmentId, type = "proforma", token } = req.query;
    if (!token || token !== SECRET) return res.status(401).send("Unauthorized");
    if (!shipmentId) return res.status(400).send("Missing shipmentId");

    // 1) Fetch Airtable
    const rec = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TB)}/${shipmentId}`,
      { headers: { Authorization: `Bearer ${PAT}` } }
    );
    if (!rec.ok) return res.status(rec.status).send("Airtable fetch failed");
    const json = await rec.json();
    const f = json.fields || {};

    // pick helper
    const pick = (alts, d="") => {
      const keys = Array.isArray(alts) ? alts : [alts];
      const k = keys.find(k => f[k] != null && f[k] !== "");
      return k ? f[k] : d;
    };

    // 2) Normalize
    const sender = {
      name: pick(["Mittente_Ragione","Mittente","Sender_Name","Mittente Ragione Sociale"], "SPST S.r.l."),
      address: pick(["Mittente_Indirizzo","Mittente Indirizzo","Sender_Address"], "Via Esempio 1, 20100 Milano (MI), Italy"),
      city: pick(["Mittente_Citta","Mittente Città","Sender_City"], "Milan"),
      vat: pick(["Mittente_VAT","P.IVA Mittente","Mittente_PIVA","Sender_VAT"], "IT12345678901"),
      email: pick(["Mittente_Email","Email Mittente","Sender_Email"], "info@spst.it"),
      phone: pick(["Mittente_Telefono","Telefono Mittente","Sender_Phone"], "+39 320 144 1789"),
    };

    const consignee = {
      name: pick(["Ragione Sociale Destinatario Fattura","Destinatario","Consignee_Name"], "Consignee Ltd"),
      address: (() => {
        const addr = pick(["Indirizzo Destinatario Fattura","Indirizzo Destinatario","Consignee_Address"], "Street 1");
        const cap  = pick(["CAP Destinatario Fattura","CAP Destinatario","Consignee_Zip"], "");
        const city = pick(["Città Destinatario Fattura","Città Destinatario","Consignee_City"], "City");
        const ctry = pick(["Paese Destinatario","Consignee_Country"], "DE");
        return [addr, [cap, city].filter(Boolean).join(" "), `(${ctry})`].filter(Boolean).join(", ");
      })(),
      taxId: pick(["Tax ID Destinatario","Destinatario_Tax","Consignee_Tax"], ""),
      email: pick(["Email Destinatario","Consignee_Email"], ""),
      phone: pick(["Telefono Destinatario Fattura","Consignee_Phone"], ""),
    };

    const pickupDate = formatDateIT(pick(["Ritiro - Data","Ritiro – Data","Data Ritiro","PickupDate"], ""));
    const incoterm = pick(["Incoterm"], "DAP");
    const currency = pick(["Valuta","Currency"], "EUR");
    const shipmentIdStr = pick(["ID Spedizione","Shipment_ID"], json.id);

    let lines = [];
    const raw = pick(["Lines_JSON","Lista Colli Ordinata","Lista Colli"], "[]");
    try { lines = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
    if (!Array.isArray(lines) || !lines.length) {
      const qty = Number(pick(["Qta Colli","Qty"], 1));
      const totalVal = Number(pick(["Valore Totale EUR","Total_Value"], 0));
      lines = [{
        description: pick(["Contenuto","Descrizione Generica"], "Goods"),
        qty, unitPrice: qty ? totalVal / qty : 0,
        hs: pick(["HS Code","HS"], ""), origin: "IT", weightKg: Number(pick(["Peso Totale Kg","Peso"], 0))
      }];
    }
    lines = lines.map((r,i) => ({
      description: r.description || r.descrizione || r.nome || `Item ${i+1}`,
      qty: Number(r.qty ?? r.quantita ?? 1),
      unitPrice: Number(r.unitPrice ?? r.prezzoUnit ?? r.valore ?? 0),
      hs: r.hs || r.hsCode || "",
      origin: r.origin || r.origine || "IT",
      weightKg: Number(r.weightKg ?? r.pesoKg ?? 0),
    }));

    const total = lines.reduce((s,r) => s + (Number(r.qty)||0) * (Number(r.unitPrice)||0), 0);

    const payload = {
      mode: type === "commercial" ? "commercial" : "proforma",
      sender,
      consignee,
      shipment: {
        id: shipmentIdStr,
        number: makeDocNumber(type, json.id),
        issueDate: formatDateIT(new Date()),
        pickupDate,
        incoterm, currency
      },
      lines, total
    };

    // 3) HTML → PDF
    const html = renderUnifiedHTML(payload);
    const executablePath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm" }});
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="${payload.shipment.number}.pdf"`);
    return res.status(200).send(Buffer.from(pdf));
  } catch (e) {
    console.error("unified/render error", e);
    return res.status(500).send("Internal Server Error");
  }
}

function formatDateIT(d){
  try{
    const dt = typeof d === "string" ? new Date(d) : d;
    const dd = String(dt.getDate()).padStart(2,"0");
    const mm = String(dt.getMonth()+1).padStart(2,"0");
    const yyyy = dt.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }catch{ return ""; }
}
function makeDocNumber(type, id){
  const pref = type === "commercial" ? (process.env.DOCS_COMMERCIAL_PREFIX || "CI") : (process.env.DOCS_PROFORMA_PREFIX || "PF");
  return `${pref}-${id}`;
}
