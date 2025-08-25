// api/quotes/create.js

// ===== CORS allowlist =====
const allowlist = (process.env.ORIGIN_ALLOWLIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// supporta wildcard tipo https://*.webflow.io
function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes('*')) {
      const esc = item
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace('\\*', '.*');
      const re = new RegExp('^' + esc + '$');
      if (re.test(origin)) return true;
    } else if (item === origin) {
      return true;
    }
  }
  return false;
}

function setCors(res, origin) {
  if (isAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ===== helpers Airtable =====
const AT_BASE   = process.env.AIRTABLE_BASE_ID;     // es: appwnx59j8NJ1x5ts
const AT_PAT    = process.env.AIRTABLE_PAT;         // token PAT
const TB_QUOTE  = process.env.TB_PREVENTIVI;        // "Preventivi"
const TB_OPT    = process.env.TB_OPZIONI;           // "OpzioniPreventivo"

async function atCreate(table, records) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AT_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    const name = json?.error?.type || 'AirtableError';
    const err = new Error(msg);
    err.name = name;
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// map util: normalizza valori che in UI sono “umani”
function mapVisibility(v) {
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (s.includes('immediat') || s === 'subito') return 'Immediata';
  if (s.includes('bozza')) return 'Solo_Bozza';
  return v; // già corretto
}

function mapIncoterm(v){ return v || undefined; } // EXW/DAP/DDP ecc.
function mapPayer(v){ return v || undefined; }    // Mittente/Destinatario

function toNumber(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

// ===== handler =====
export default async function handler(req, res) {
  const origin = req.headers.origin;
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  try {
    // --- sanity env
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error('Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI');
    }

    const body = req.body && typeof req.body === 'object'
      ? req.body
      : JSON.parse(req.body || '{}');

    // body atteso (minimo):
    // {
    //   customerEmail, currency, validUntil, notes,
    //   sender: { name,country,city,zip,address,phone,tax },
    //   recipient: { name,country,city,zip,address,phone,tax },
    //   terms: { version, visibility, linkExpiryDays, slug },
    //   options: [{ index, carrier, service, transit, incoterm, payer, price, currency, weight, notes, recommended }]
    // }

    // --- campi Preventivo
    const qFields = {
      Email_Cliente   : body.customerEmail || undefined,
      Valuta          : body.currency || undefined,
      Valido_Fino_Al  : body.validUntil || undefined,
      Note_Globali    : body.notes || undefined,

      Mittente_Nome    : body.sender?.name,
      Mittente_Paese   : body.sender?.country,
      Mittente_Citta   : body.sender?.city,
      Mittente_CAP     : body.sender?.zip,
      Mittente_Indirizzo: body.sender?.address,
      Mittente_Telefono : body.sender?.phone,
      Mittente_TaxID    : body.sender?.tax,

      Destinatario_Nome     : body.recipient?.name,
      Destinatario_Paese    : body.recipient?.country,
      Destinatario_Citta    : body.recipient?.city,
      Destinatario_CAP      : body.recipient?.zip,
      Destinatario_Indirizzo: body.recipient?.address,
      Destinatario_Telefono : body.recipient?.phone,
      Destinatario_TaxID    : body.recipient?.tax,

      Versione_Termini  : body.terms?.version,
      Visibilita        : mapVisibility(body.terms?.visibility),
      Slug_Pubblico     : body.terms?.slug,
      Scadenza_Link     : body.terms?.linkExpiryDate, // opzionale: se la calcoli lato FE
    };

    // crea Preventivo
    const qResp = await atCreate(TB_QUOTE, [{ fields: qFields }]);
    const quoteId = qResp.records?.[0]?.id;
    if (!quoteId) {
      throw new Error('Quote created but no record id returned');
    }

    // crea Opzioni col link inverso
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    if (rawOptions.length) {
      const optRecords = rawOptions.map(o => ({
        fields: {
          Preventivo     : [ { id: quoteId } ],
          Indice         : toNumber(o.index),
          Corriere       : o.carrier,
          Servizio       : o.service,
          Tempo_Resa     : o.transit,
          Incoterm       : mapIncoterm(o.incoterm),
          Oneri_A_Carico : mapPayer(o.payer),
          Prezzo         : toNumber(o.price),
          Valuta         : o.currency || body.currency,
          Peso_Kg        : toNumber(o.weight),
          Note_Operative : o.notes,
          Consigliata    : !!o.recommended,
        }
      }));

      // max 10 per batch (Airtable), ma qui ne hai 2 quindi ok:
      await atCreate(TB_OPT, optRecords);
    }

    return res.status(200).json({ ok:true, id: quoteId });
  } catch (err) {
    // prova a estrarre l’errore Airtable per capire i single select sbagliati
    const status = err.status || 500;
    const details = err.payload || { message: err.message, name: err.name };
    console.error('[quotes/create] error:', details);
    return res.status(status).json({ ok:false, error: details });
  }
}
