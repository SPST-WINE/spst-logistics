// api/quotes/create.js

// ===== CORS allowlist (domini autorizzati a chiamare questa API) ==========
const allowlist = (process.env.ORIGIN_ALLOWLIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes('*')) {
      // wildcard: https://*.webflow.io
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

// ===== ENV / Airtable ======================================================
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;      // es. "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;         // es. "OpzioniPreventivo"

// Base pubblica per i link del preventivo (senza trailing slash)
const PUBLIC_QUOTE_BASE_URL =
  (process.env.PUBLIC_QUOTE_BASE_URL || 'https://spst-logistics.vercel.app/quote').replace(/\/$/, '');

// === helpers fetch Airtable =================================================
async function atCreate(table, records) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AT_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  });
  const json = await r.json();
  if (!r.ok) {
    const err = new Error(json?.error?.message || 'Airtable error');
    err.status = r.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// === helpers vari ==========================================================
function mapVisibility(v) {
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (s.includes('immed') || s === 'subito') return 'Immediata';
  if (s.includes('bozza')) return 'Solo_Bozza';
  return v;
}
function mapIncoterm(v) { return v || undefined; }
function mapPayer(v) { return v || undefined; }
function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : undefined; }
function fmtISODate(d) { try { return new Date(d).toISOString().slice(0,10); } catch { return undefined; } }

function makeSlug() {
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 7);
  return `q-${y}${m}${dd}-${rand}`;
}

// ===== handler =============================================================
export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try {
    // sanity env
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error('Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI');
    }

    // parse body
    const body = req.body && typeof req.body === 'object'
      ? req.body
      : JSON.parse(req.body || '{}');

    // ======= CREA RECORD PREVENTIVO =======================================
    const slug = makeSlug();

    const qFields = {
      // Anagrafica cliente / intestazione
      Email_Cliente   : body.customerEmail || undefined,
      Valuta          : body.currency || undefined,
      Valido_Fino_Al  : body.validUntil ? fmtISODate(body.validUntil) : undefined,
      Note_Globali    : body.notes || undefined,

      // Mittente
      Mittente_Nome      : body.sender?.name || undefined,
      Mittente_Paese     : body.sender?.country || undefined,
      Mittente_Citta     : body.sender?.city || undefined,
      Mittente_CAP       : body.sender?.zip || undefined,
      Mittente_Indirizzo : body.sender?.address || undefined,
      Mittente_Telefono  : body.sender?.phone || undefined,
      Mittente_Tax       : body.sender?.tax || undefined,     // <- nome campo in base

      // Destinatario
      Destinatario_Nome      : body.recipient?.name || undefined,
      Destinatario_Paese     : body.recipient?.country || undefined,
      Destinatario_Citta     : body.recipient?.city || undefined,
      Destinatario_CAP       : body.recipient?.zip || undefined,
      Destinatario_Indirizzo : body.recipient?.address || undefined,
      Destinatario_Telefono  : body.recipient?.phone || undefined,
      Destinatario_Tax       : body.recipient?.tax || undefined,

      // Termini & pubblicazione
      Versione_Termini  : body.terms?.version || 'v1.0',
      Visibilita        : mapVisibility(body.terms?.visibility) || 'Immediata',
      Slug_Pubblico     : slug,
      Scadenza_Link     : toNumber(body.terms?.linkExpiryDays), // (giorni) se esiste il campo numerico
      // Se aveste anche una data calcolata, aggiungete un campo tipo 'Link_Expiry_Data'
      // Link_Expiry_Data  : body.terms?.linkExpiryDate ? fmtISODate(body.terms.linkExpiryDate) : undefined,
    };

    const qResp = await atCreate(TB_QUOTE, [{ fields: qFields }]);
    const quoteId = qResp.records?.[0]?.id;
    if (!quoteId) throw new Error('Quote created but no record id returned');

    // ======= CREA OPZIONI (collegandole al preventivo) ====================
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    if (rawOptions.length) {
      const optRecords = rawOptions.map(o => ({
        fields: {
          Preventivo     : [quoteId],                 // link record id
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

      // Airtable: max 10 per batch (qui di solito 1–2)
      await atCreate(TB_OPT, optRecords);
    }

    // ======= URL pubblico (pagina cliente) =================================
    const publicUrl = `${PUBLIC_QUOTE_BASE_URL}/${encodeURIComponent(slug)}`;

    return res.status(200).json({ ok:true, id: quoteId, slug, url: publicUrl });
  } catch (err) {
    const status  = err.status || 500;
    const details = err.payload || { name: err.name, message: err.message, stack: err.stack };
    console.error('[api/quotes/create] error →', details);
    return res.status(status).json({ ok:false, error: details });
  }
}
