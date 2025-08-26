// api/quotes/create.js

// ===== CORS allowlist =====
const allowlist = (process.env.ORIGIN_ALLOWLIST || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes("*")) {
      const esc = item.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("\\*", ".*");
      const re = new RegExp("^" + esc + "$");
      if (re.test(origin)) return true;
    } else if (item === origin) {
      return true;
    }
  }
  return false;
}

function setCors(res, origin) {
  if (isAllowed(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

// ===== Airtable =====
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;      // "OpzioniPreventivo"

async function atCreate(table, records) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AT_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ records }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json?.error?.message || "Airtable error");
    err.name = json?.error?.type || "AirtableError";
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// ===== utils =====
function mapVisibility(v) {
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (s.includes("immediat") || s === "subito") return "Immediata";
  if (s.includes("bozza")) return "Solo_Bozza";
  return v;
}
const mapIncoterm = v => v || undefined;
const mapPayer    = v => v || undefined;
function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }
function addDays(base, days){
  const d = new Date(base);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}
function getBestIndex(options) {
  const chosen = options.find(o => !!o.recommended);
  if (chosen) return toNumber(chosen.index);
  const priced = options.filter(o => typeof o.price === "number");
  if (!priced.length) return undefined;
  priced.sort((a,b) => a.price - b.price);
  return toNumber(priced[0].index);
}

// ===== handler =====
export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ ok:false, error:"Method Not Allowed" });

  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error("Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI");
    }

    const body  = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const debug = (typeof req.url === "string") && req.url.includes("debug=1");

    // ---- slug + scadenza
    const now  = new Date();
    const slug = `q-${now.toISOString().slice(2,10).replace(/-/g,"")}-${Math.random().toString(36).slice(2,7)}`;

    let expiryDate;
    if (body?.terms?.linkExpiryDate) {
      const d = new Date(body.terms.linkExpiryDate);
      if (!Number.isNaN(+d)) expiryDate = d;
    } else if (body?.terms?.linkExpiryDays) {
      expiryDate = addDays(now, body.terms.linkExpiryDays);
    }

    // base URL pubblico
    const PUBLIC_QUOTE_BASE_URL =
      (process.env.PUBLIC_QUOTE_BASE_URL || "https://spst-logistics.vercel.app/quote").replace(/\/$/,"");
    const publicUrl = `${PUBLIC_QUOTE_BASE_URL}/${encodeURIComponent(slug)}`;

    // ---- campi Preventivo
    const qFields = {
      Email_Cliente   : body.customerEmail || undefined,
      Valuta          : body.currency || undefined,
      Valido_Fino_Al  : body.validUntil || undefined, // "YYYY-MM-DD"
      Note_Globali    : body.notes || undefined,

      Mittente_Nome      : body.sender?.name || undefined,
      Mittente_Paese     : body.sender?.country || undefined,
      Mittente_Citta     : body.sender?.city || undefined,
      Mittente_CAP       : body.sender?.zip || undefined,
      Mittente_Indirizzo : body.sender?.address || undefined,
      Mittente_Telefono  : body.sender?.phone || undefined,
      Mittente_Tax       : body.sender?.tax || undefined,

      Destinatario_Nome      : body.recipient?.name || undefined,
      Destinatario_Paese     : body.recipient?.country || undefined,
      Destinatario_Citta     : body.recipient?.city || undefined,
      Destinatario_CAP       : body.recipient?.zip || undefined,
      Destinatario_Indirizzo : body.recipient?.address || undefined,
      Destinatario_Telefono  : body.recipient?.phone || undefined,
      Destinatario_Tax       : body.recipient?.tax || undefined,

      Versione_Termini  : body.terms?.version || "v1.0",
      Visibilita        : mapVisibility(body.terms?.visibility) || "Immediata",
      Slug_Pubblico     : slug,                                  // NON scrivere URL_Pubblico (formula)
      Scadenza_Link     : expiryDate ? expiryDate.toISOString() : undefined,

      Opzione_Consigliata: getBestIndex(Array.isArray(body.options) ? body.options : []),
    };

    // ---- DEBUG (dry-run)
    if (debug) {
      const rawOptions = Array.isArray(body.options) ? body.options : [];
      const wouldOptions = rawOptions.map(o => ({
        Preventivo     : "<record id created after>",
        Indice         : toNumber(o.index),
        Corriere       : o.carrier || undefined,
        Servizio       : o.service || undefined,
        Tempo_Resa     : o.transit || undefined,
        Incoterm       : mapIncoterm(o.incoterm),
        Oneri_A_Carico : mapPayer(o.payer),
        Prezzo         : toNumber(o.price),
        Valuta         : o.currency || body.currency || undefined,
        Peso_Kg        : toNumber(o.weight),
        Note_Operative : o.notes || undefined,
        Consigliata    : !!o.recommended,
      }));
      return res.status(200).json({ ok:true, debug:true, wouldCreate:{ preventivo:qFields, opzioni:wouldOptions, slug, url: publicUrl } });
    }

    // ---- crea Preventivo
    const qResp   = await atCreate(TB_QUOTE, [{ fields: qFields }]);
    const quoteId = qResp.records?.[0]?.id;
    if (!quoteId || typeof quoteId !== "string") {
      throw new Error("Quote created but no valid record id returned");
    }

    // ---- crea Opzioni (dopo avere quoteId!)
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    if (rawOptions.length) {
      const optRecords = rawOptions.map(o => ({
        fields: {
          Preventivo     : [{ id: quoteId }],          // array di record-link objects
          Indice         : toNumber(o.index),
          Corriere       : o.carrier || undefined,
          Servizio       : o.service || undefined,
          Tempo_Resa     : o.transit || undefined,
          Incoterm       : mapIncoterm(o.incoterm),
          Oneri_A_Carico : mapPayer(o.payer),
          Prezzo         : toNumber(o.price),
          Valuta         : o.currency || body.currency || undefined,
          Peso_Kg        : toNumber(o.weight),
          Note_Operative : o.notes || undefined,
          Consigliata    : !!o.recommended,
        }
      }));
      await atCreate(TB_OPT, optRecords);
    }

    return res.status(200).json({ ok:true, id: quoteId, slug, url: publicUrl });
  } catch (err) {
    const status  = err.status || 500;
    const details = err.payload || { name: err.name, message: err.message, stack: err.stack };
    console.error("[api/quotes/create] error:", details);
    return res.status(status).json({ ok:false, error: details });
  }
}
