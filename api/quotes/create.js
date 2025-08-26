// api/quotes/create.js

// ===== CORS allowlist =====
const allowlist = (process.env.ORIGIN_ALLOWLIST || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes('*')) {
      const esc = item.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*');
      if (new RegExp('^' + esc + '$').test(origin)) return true;
    } else if (item === origin) return true;
  }
  return false;
}
function setCors(res, origin) {
  if (isAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ===== helpers Airtable =====
const AT_BASE   = process.env.AIRTABLE_BASE_ID;
const AT_PAT    = process.env.AIRTABLE_PAT;
const TB_QUOTE  = process.env.TB_PREVENTIVI;       // "Preventivi"
const TB_OPT    = process.env.TB_OPZIONI;          // "OpzioniPreventivo"

// dominio pubblico per le view
const PUBLIC_VIEW_BASE =
  process.env.PUBLIC_VIEW_BASE || 'https://www.spst.it/p'; // es. https://www.spst.it/p

async function atCreate(table, records) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json?.error?.message || 'Airtable create failed');
    err.status = resp.status; err.payload = json; err.name = json?.error?.type || 'AirtableError';
    throw err;
  }
  return json;
}
async function atPatch(table, id, fields) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ id, fields }] }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json?.error?.message || 'Airtable patch failed');
    err.status = resp.status; err.payload = json; err.name = json?.error?.type || 'AirtableError';
    throw err;
  }
  return json;
}

function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }
function mapVisibility(v) {
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (s.includes('immediat') || s === 'subito') return 'Immediata';
  if (s.includes('bozza')) return 'Solo_Bozza';
  return v;
}
function mapIncoterm(v){ return v || undefined; }
function mapPayer(v){ return v || undefined; }

// slug: corto, leggibile, univoco
function makeSlug(recordId='') {
  const rnd = Math.random().toString(36).slice(2, 7);
  const base = recordId.replace(/^rec/i,'').slice(0,4).toLowerCase();
  return `${base}-${rnd}`;
}
function addDaysISO(startISO, days=14) {
  if (!startISO || !days) return undefined;
  const d = new Date(startISO);
  if (!Number.isFinite(+d)) return undefined;
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0,10); // YYYY-MM-DD
}

// ===== handler =====
export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT)
      throw new Error('Missing env AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI');

    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body||'{}');

    // --- campi Preventivo
    const qFields = {
      Email_Cliente   : body.customerEmail || undefined,
      Valuta          : body.currency || undefined,
      Valido_Fino_Al  : body.validUntil || undefined,
      Note_Globali    : body.notes || undefined,

      Mittente_Nome     : body.sender?.name,
      Mittente_Paese    : body.sender?.country,
      Mittente_Citta    : body.sender?.city,
      Mittente_CAP      : body.sender?.zip,
      Mittente_Indirizzo: body.sender?.address,
      Mittente_Telefono : body.sender?.phone,
      Mittente_Tax      : body.sender?.tax,

      Destinatario_Nome     : body.recipient?.name,
      Destinatario_Paese    : body.recipient?.country,
      Destinatario_Citta    : body.recipient?.city,
      Destinatario_CAP      : body.recipient?.zip,
      Destinatario_Indirizzo: body.recipient?.address,
      Destinatario_Telefono : body.recipient?.phone,
      Destinatario_Tax      : body.recipient?.tax,

      Versione_Termini : body.terms?.version,
      Visibilita       : mapVisibility(body.terms?.visibility),
      Slug_Pubblico    : undefined,               // verrà messo dopo create
      Scadenza_Link    : undefined,               // data (YYYY-MM-DD)
    };

    // crea Preventivo
    const qResp = await atCreate(TB_QUOTE, [{ fields: qFields }]);
    const quoteId = qResp.records?.[0]?.id;
    if (!quoteId) throw new Error('Quote created but no record id returned');

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
      await atCreate(TB_OPT, optRecords);
    }

    // genera slug & scadenza se manca
    const slug = body.terms?.slug && body.terms.slug.trim()
      ? body.terms.slug.trim()
      : makeSlug(quoteId);

    const linkExpiryDays = Number(body.terms?.linkExpiryDays) || undefined;
    const expiryDate = (qFields.Visibilita === 'Immediata' && body.validUntil && linkExpiryDays)
      ? addDaysISO(new Date().toISOString().slice(0,10), linkExpiryDays)
      : undefined;

    await atPatch(TB_QUOTE, quoteId, {
      Slug_Pubblico: slug,
      Scadenza_Link: expiryDate,
    });

    const url = `${PUBLIC_VIEW_BASE}/${encodeURIComponent(slug)}`;
    return res.status(200).json({ ok:true, id: quoteId, slug, url });
  } catch (err) {
    const status = err.status || 500;
    console.error('[quotes/create] error:', err.payload || err);
    return res.status(status).json({ ok:false, error: err.payload || { name: err.name, message: err.message } });
  }
}
