// api/docs/unified/dle_writer.js
// GENERATORE "DA ZERO" (nessun PDF di riferimento): crea un PDF A4 con layout fisso e dati da Airtable.
// Accetta: ?type=dle:fedex | dle:ups | dle  +  sid/ship + exp + sig  (stessa firma flessibile del resto)
// Requisiti opzionali: assets/fonts/Inter-Regular.ttf (se manca, fallback a Helvetica)

export const config = { runtime: "nodejs" };

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

// ---------- ENV ----------
const AIRTABLE_PAT     = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const DOCS_SIGN_SECRET = process.env.DOCS_SIGN_SECRET || "";
const BYPASS_SIGNATURE = process.env.BYPASS_SIGNATURE === "1";
const DEBUG_DOCS       = process.env.DEBUG_DOCS === "1";

// ---------- LOG ----------
const dlog = (...a) => { if (DEBUG_DOCS) console.log("[dle-writer]", ...a); };
const derr = (...a) => { console.error("[dle-writer:ERR]", ...a); };

// ---------- PATHS ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "..", "..", "..", "assets");
const INTER_TTF  = path.join(ASSETS_DIR, "fonts", "Inter-Regular.ttf");

// ---------- AIRTABLE ----------
const API_ROOT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const TB_SPEDIZIONI = "SpedizioniWebApp";

async function airFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(()=> "");
    throw new Error(`Airtable ${res.status} ${body || ""}`);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function getShipmentBySid(sid) {
  if (/^rec[0-9A-Za-z]{14}/.test(String(sid))) {
    try { return await airFetch(`${API_ROOT}/${encodeURIComponent(TB_SPEDIZIONI)}/${encodeURIComponent(sid)}`); }
    catch { /* noop */ }
  }
  const candidates = [
    "ID Spedizione","Id Spedizione","ID spedizione","id spedizione",
    "ID\u00A0Spedizione","IDSpedizione","Spedizione - ID","Shipment ID","ID"
  ];
  const safe = String(sid).replace(/'/g, "\\'");
  for (const field of candidates) {
    const url = `${API_ROOT}/${encodeURIComponent(TB_SPEDIZIONI)}?filterByFormula=${encodeURIComponent(`{${field}}='${safe}'`)}&maxRecords=1`;
    try {
      const data = await airFetch(url);
      const rec  = data?.records?.[0];
      if (rec) return rec;
    } catch { /* try next */ }
  }
  return null;
}

// ---------- SIG ----------
function safeEqual(a,b){ try{ return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }catch{ return false; } }
function verifySigFlexible({ sid, rawType, normType, exp, sig }) {
  if (BYPASS_SIGNATURE) return true;
  if (!sid || !rawType || !exp || !sig) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Number(exp) < now) return false;
  const h1 = crypto.createHmac("sha256", DOCS_SIGN_SECRET).update(`${sid}.${rawType}.${exp}`).digest("hex");
  const h2 = crypto.createHmac("sha256", DOCS_SIGN_SECRET).update(`${sid}.${normType}.${exp}`).digest("hex");
  const q  = `sid=${encodeURIComponent(String(sid))}&type=${encodeURIComponent(String(rawType))}&exp=${encodeURIComponent(String(exp))}`;
  const h3 = crypto.createHmac("sha256", DOCS_SIGN_SECRET).update(q).digest("hex");
  return safeEqual(h1, String(sig)) || safeEqual(h2, String(sig)) || safeEqual(h3, String(sig));
}

// ---------- UTILS ----------
const get = (obj, keys, def = "") => { for (const k of keys) { const v = obj?.[k]; if (v !== undefined && v !== null && v !== "") return v; } return def; };
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString("it-IT"); } catch { return ""; } };
function normalizeType(t) {
  const raw = String(t || "dle").toLowerCase().trim();
  if (raw.includes("fedex")) return "dle_fedex";
  if (raw.includes("ups"))   return "dle_ups";
  return "dle_generic";
}
const PT_PER_MM = 72 / 25.4;
const mm = (x) => x * PT_PER_MM;

// ---------- DATA ----------
function extractData(ship){
  const f = ship.fields || {};
  const mitt = {
    rs:   get(f, ["Mittente - Ragione Sociale"], ""),
    piva: get(f, ["Mittente - P.IVA/CF"], ""),
    ind:  get(f, ["Mittente - Indirizzo"], ""),
    cap:  get(f, ["Mittente - CAP"], ""),
    city: get(f, ["Mittente - Città"], ""),
    country: get(f, ["Mittente - Paese"], "Italy"),
    tel:  get(f, ["Mittente - Telefono"], ""),
    ref:  get(f, ["Mittente - Referente","Referente Mittente"], ""),
    email:get(f, ["Mittente - Email","Email Mittente"], ""),
  };
  const carrier     = get(f, ["Corriere","Carrier"], "");
  const destCountry = get(f, ["Destinatario - Paese"], "");
  const sid         = get(f, ["ID Spedizione","Id Spedizione"], ship.id);
  const invNo       = get(f, ["Fattura - Numero","Commercial Invoice - Numero","Proforma - Numero"], "") || `CI-${sid}`;
  const pickup      = get(f, ["Ritiro - Data"], "") || f["Ritiro Data"];
  const dateStr     = fmtDate(pickup) || fmtDate(Date.now());
  const placeDt     = `${mitt.city}, ${dateStr}`;

  const addr   = [mitt.ind, `${mitt.cap} ${mitt.city}`, mitt.country].filter(Boolean).join(" · ");
  const vatTel = [mitt.piva && `VAT/CF: ${mitt.piva}`, mitt.tel && `TEL: ${mitt.tel}`].filter(Boolean).join(" · ");

  return { mitt, carrier, destCountry, sid, invNo, dateStr, placeDt, addr, vatTel };
}

// ---------- PDF CORE ----------
async function createDoc() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([mm(210), mm(297)]); // A4
  let font = null;

  // try Inter; fallback Helvetica
  try {
    const bytes = await readFile(INTER_TTF);
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(bytes, { subset: true });
    dlog("Font Inter embedded");
  } catch {
    font = await pdf.embedFont(StandardFonts.Helvetica);
    dlog("Font fallback to Helvetica");
  }

  const fontBold = font; // semplice: usiamo lo stesso (Inter Regular o Helvetica)
  return { pdf, page, font, fontBold };
}

function textWidth(font, size, str) { return font.widthOfTextAtSize(String(str || ""), size); }

function drawText(page, font, str, x, y, size = 10, color = rgb(0,0,0)) {
  page.drawText(String(str ?? ""), { x, y, size, font, color });
}

function wrapText(page, font, str, x, yTop, maxW, size = 10, lineGap = 2) {
  const words = String(str ?? "").split(/\s+/);
  let line = "";
  let y = yTop;
  const lh = size + lineGap;
  for (const w of words) {
    const test = (line ? line + " " : "") + w;
    if (textWidth(font, size, test) > maxW && line) {
      page.drawText(line, { x, y, size, font });
      y -= lh;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) { page.drawText(line, { x, y, size, font }); y -= lh; }
  return y;
}

function hr(page, x, y, w, h = 0.6, color = rgb(0.9,0.9,0.9)) {
  page.drawRectangle({ x, y, width: w, height: h, color });
}

function box(page, x, y, w, h, color = rgb(1,1,1), border = rgb(0.9,0.9,0.9)) {
  page.drawRectangle({ x, y, width: w, height: h, color });
  page.drawRectangle({ x, y, width: w, height: h, borderColor: border, borderWidth: 0.8, color: undefined });
}

// ---------- TEMPLATES (from scratch) ----------
function drawGenericHeader({ page, font, fontBold }, data, titleRight = "Export Free Declaration") {
  // margins
  const left   = mm(16);
  const right  = mm(210-16);
  const top    = mm(297-18);
  const colGap = mm(8);

  // left brand
  drawText(page, fontBold, data.mitt.rs, left, top, 14);
  const meta = [`Shipment ID: ${data.sid}`, data.mitt.email && `Email: ${data.mitt.email}`, data.mitt.tel && `Tel: ${data.mitt.tel}`]
    .filter(Boolean).join(" · ");
  drawText(page, font, meta, left, top - mm(6), 9);

  // right doc meta box
  const boxW = mm(70);
  const boxH = mm(26);
  const bx = right - boxW;
  const by = top - mm(2) - boxH + mm(2);
  box(page, bx, by, boxW, boxH, rgb(1,1,1), rgb(0.85,0.85,0.9));
  drawText(page, fontBold, titleRight, bx + mm(4), by + boxH - mm(8), 9, rgb(0.07,0.07,0.07));
  drawText(page, font, `Date: ${data.dateStr}`, bx + mm(4), by + boxH - mm(14), 9);
  drawText(page, font, `Place: ${data.mitt.city}`, bx + mm(4), by + boxH - mm(20), 9);

  // TO carrier
  const toY = top - mm(18);
  drawText(page, fontBold, "To:", left, toY, 10);
  drawText(page, font, data.carrier || "—", left + mm(8), toY, 10);

  // separator
  hr(page, left, toY - mm(4), right - left);
  return { left, right, y: toY - mm(8) };
}

function drawFedExBody({ page, font, fontBold }, data, cursor) {
  const left = cursor.left;
  let y = cursor.y;
  const right = cursor.right;
  const maxW = (right - left);

  // mittente blocco
  drawText(page, fontBold, "Shipper", left, y, 10); y -= mm(5);
  y = wrapText(page, font, data.mitt.rs, left, y, maxW, 10);
  y = wrapText(page, font, data.addr, left, y, maxW, 10);
  y = wrapText(page, font, data.vatTel, left, y, maxW, 10);
  y -= mm(2);

  // meta
  drawText(page, font, `Invoice No.: ${data.invNo}`, left, y, 10);
  drawText(page, font, `Origin Country: ITALY`, left + mm(60), y, 10);
  drawText(page, font, `Destination Country: ${(data.destCountry || "").toUpperCase()}`, left + mm(110), y, 10);
  y -= mm(8);
  hr(page, left, y, (right - left));
  y -= mm(4);

  // testo normativo (versione inglese)
  const bullets = [
    "The goods are not included in the CITES list (Council Regulation (EC) No. 338/97).",
    "The goods are not cultural goods under Council Regulation (EC) No. 116/2009.",
    "The goods are not subject to Regulation (EU) No. 821/2021 (dual-use items).",
    "The goods are not covered by Regulation (EU) No. 125/2019 on certain goods used for capital punishment or torture.",
    "The goods do not contain cat or dog fur (Council Regulation (EC) No. 1523/2007).",
    "The goods are not subject to Regulation (EU) No. 649/2012 (hazardous chemicals).",
    "The goods are not included in Regulation (EU) No. 590/2024 (ozone-depleting substances).",
    "The goods are not subject to Regulation (EC) No. 1013/2006 (shipments of waste).",
    "The goods are not included in restrictive measures under the following EU Regulations/Decisions: 1210/2003 (Iraq), 2016/44 (Libya), 36/2012 (Syria), 765/2006 (Belarus), 833/2014 & 2014/512/CFSP (Russia/Ukraine), 692/2014 (Crimea/Sevastopol), 2022/263 (Ukrainian territories occupied by the Russian Federation).",
    "The goods are for civilian use only and have no dual-use or military purpose.",
  ];
  drawText(page, fontBold, "Declaration", left, y, 10); y -= mm(5);
  for (const b of bullets) {
    y = wrapText(page, font, `• ${b}`, left, y, (right - left), 10, 2);
  }
  y -= mm(4);

  // footer: place/date + signature box
  drawText(page, fontBold, "Place:", left, y, 10);
  drawText(page, font, data.mitt.city, left + mm(12), y, 10);
  drawText(page, fontBold, "Date:", left + mm(60), y, 10);
  drawText(page, font, data.dateStr, left + mm(72), y, 10);
  const sigY = y - mm(16);
  drawText(page, fontBold, "Signature of Shipper:", left, sigY + mm(12), 10);
  page.drawRectangle({ x: left + mm(40), y: sigY, width: mm(80), height: mm(16), borderColor: rgb(0.8,0.84,0.9), borderWidth: 1 });
}

function drawUPSBody(ctx, data, cursor) {
  // per UPS manteniamo layout quasi identico, con titolazioni italiane
  const { page, font, fontBold } = ctx;
  const left = cursor.left;
  let y = cursor.y;
  const right = cursor.right;

  drawText(page, fontBold, "Il sottoscritto", left, y, 10); y -= mm(5);
  y = wrapText(page, font, data.mitt.ref || data.mitt.rs, left, y, (right - left), 10);
  y = wrapText(page, font, data.mitt.rs, left, y, (right - left), 10);
  y -= mm(3);

  drawText(page, fontBold, "Dichiara che:", left, y, 10); y -= mm(5);
  const bulletsIT = [
    "I beni non rientrano nell’elenco CITES (Reg. (CE) n. 338/97).",
    "I beni non sono beni culturali ai sensi del Reg. (CE) n. 116/2009.",
    "I beni non sono soggetti al Reg. (UE) n. 821/2021 (prodotti a duplice uso).",
    "I beni non rientrano nel Reg. (UE) n. 125/2019 (merci utilizzabili per pene capitali o tortura).",
    "I beni non contengono pellicce di cane o gatto (Reg. (CE) n. 1523/2007).",
    "I beni non sono soggetti al Reg. (UE) n. 649/2012 (sostanze chimiche pericolose).",
    "I beni non rientrano nel Reg. (UE) n. 590/2024 (sostanze che riducono lo strato di ozono).",
    "I beni non sono soggetti al Reg. (CE) n. 1013/2006 (spedizioni di rifiuti).",
    "I beni non sono soggetti alle misure restrittive UE (1210/2003 Iraq, 2016/44 Libia, 36/2012 Siria, 765/2006 Bielorussia, 833/2014 & 2014/512/PESC Russia/Ucraina, 692/2014 Crimea/Sevastopoli, 2022/263 Territori ucraini occupati).",
    "I beni sono destinati esclusivamente a uso civile e non hanno finalità dual-use o militari.",
  ];
  for (const b of bulletsIT) {
    y = wrapText(page, font, `• ${b}`, left, y, (right - left), 10, 2);
  }
  y -= mm(4);

  drawText(page, fontBold, "Luogo:", left, y, 10);
  drawText(page, font, data.mitt.city, left + mm(14), y, 10);
  drawText(page, fontBold, "Data:", left + mm(60), y, 10);
  drawText(page, font, data.dateStr, left + mm(72), y, 10);

  const sigY = y - mm(16);
  drawText(page, fontBold, "Firma:", left, sigY + mm(12), 10);
  page.drawRectangle({ x: left + mm(14), y: sigY, width: mm(80), height: mm(16), borderColor: rgb(0.8,0.84,0.9), borderWidth: 1 });
}

// ---------- HANDLER ----------
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const rawType = String(q.type || "dle").toLowerCase();
    const type    = normalizeType(rawType);
    const sid     = q.sid || q.ship;
    const sig     = q.sig;
    const exp     = q.exp;

    if (!sid) return res.status(400).json({ ok:false, error:"Missing sid/ship" });
    if (!verifySigFlexible({ sid, rawType, normType: type, exp, sig })) {
      return res.status(401).json({ ok:false, error:"Invalid signature" });
    }

    const ship = await getShipmentBySid(sid);
    if (!ship) return res.status(404).json({ ok:false, error:`No shipment found for ${sid}` });

    const data = extractData(ship);

    // Create PDF
    const ctx = await createDoc();
    const { pdf, page, font, fontBold } = ctx;

    // Header
    const header = drawGenericHeader(ctx, data, "Export Free Declaration");

    // Body variant
    if (type === "dle_ups") {
      drawUPSBody(ctx, data, header);
    } else {
      drawFedExBody(ctx, data, header);
    }

    // Output
    const bytes = await pdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="DLE_${type.includes('ups')?'UPS':'GEN'}_${data.sid}.pdf"`);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(200).send(Buffer.from(bytes));
  } catch (err) {
    derr("writer error", err?.message || err);
    try { return res.status(500).json({ ok:false, error:"Writer error", detail:String(err?.message||err) }); }
    catch {}
  }
}
