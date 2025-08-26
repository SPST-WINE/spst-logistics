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

// ===== Airtable env =====
const AT_BASE  = process.env.AIRTABLE_BASE_ID;     // es: appXXXX
const AT_PAT   = process.env.AIRTABLE_PAT;         // token PAT
const TB_QUOTE = process.env.TB_PREVENTIVI;        // "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;           // "OpzioniPreventivo"

// URL pubblico (dove serviremo /quote/[slug])
const PUBLIC_BASE = process.env.PUBLIC_BASE || 'https://spst-logistics.vercel.app';

async function atFetch(path, init={}) {
  const resp = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${AT_PAT}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    }
  });
  const json = await resp.json();
  if (!resp.ok) {
    const e = new Error(json?.error?.message || `Airtable ${resp.status}`);
    e.status = resp.status; e.payload = json;
    throw e;
  }
  return json;
}
async function atCreate(table, records) {
  return atFetch(encodeURIComponent(table), {
    method: 'POST',
    body: JSON.stringify({ records })
  });
}

// ===== utils =====
function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }
function mapVisibility(v) {
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (s.includes('immed') || s === 'subito') return 'Immediata';
  if (s.includes('bozza')) return 'Solo_Bozza';
  return v;
}
function generateSlug(d=new Date()){
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const rand = Math.random().toString(36).slice(2,7).toLowerCase();
  return `q-${yy}${mm}${dd}-${rand}`;
}
async function slugExists(slug){
  const ff = encodeURIComponent(`{Slug_Pubblico}="${slug}"`);
  const data = await atFetch(`${encodeURIComponent(TB_QUOTE)}?maxRecords=1&filterByFormula=${ff}`);
  return (data.records || []).length > 0;
}
async function uniqueSlug() {
  for (let i=0;i<6;i++){
    const s = generateSlug();
    if (!(await slugExists(s))) return s;
  }
  // estremo: aggiungi più entropia
  return generateSlug(new Date(Date.now()+Math.random()*1e6));
}

function addDays(dateStr, days){
  if (!dateStr && typeof days!=='number') return undefined;
  const base = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(+base)) return undefined;
  base.setDate(base.getDate() + (days||0));
  return base.toISOString().slice(0,10);
}

// ===== handler =====
export default async function handler(req, res) {
  const origin = req.headers.origin;
  setCors(res, origin);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')  return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error('Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI');
    }

    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

    // slug unico (se non passato dal FE)
    const slug = (body?.terms?.slug && String(body.terms.slug).trim()) || await uniqueSlug();

    // calcola scadenza link: se passi days → data; se passi già la data, la usiamo
    const linkExpiryDate =
      body?.terms?.linkExpiryDate ||
      (typeof body?.terms?.linkExpiryDays === 'number'
        ? addDays(undefined, body.terms.linkExpiryDays)
        : undefined);

    // campi Preventivo
    const qFields = {
      Email_Cliente      : body.customerEmail || undefined,
      Valuta             : body.currency || undefined,
      Valido_Fino_Al     : body.validUntil || undefined,
      Note_Globali       : body.notes || undefined,

      Mittente_Nome      : body.sender?.name,
      Mittente_Paese     : body.sender?.country,
      Mittente_Citta     : body.sender?.city,
      Mittente_CAP       : body.sender?.zip,
      Mittente_Indirizzo : body.sender?.address,
      Mittente_Telefono  : body.sender?.phone,
      Mittente_Tax       : body.sender?.tax,

      Destinatario_Nome      : body.recipient?.name,
      Destinatario_Paese     : body.recipient?.country,
      Destinatario_Citta     : body.recipient?.city,
      Destinatario_CAP       : body.recipient?.zip,
      Destinatario_Indirizzo : body.recipient?.address,
      Destinatario_Telefono  : body.recipient?.phone,
      Destinatario_Tax       : body.recipient?.tax,

      Versione_Termini   : body.terms?.version,
      Visibilita         : mapVisibility(body.terms?.visibility), // Immediata / Solo_Bozza
      Slug_Pubblico      : slug,
      Scadenza_Link      : linkExpiryDate, // YYYY-MM-DD
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
          Incoterm       : o.incoterm || undefined,
          Oneri_A_Carico : o.payer || undefined,
          Prezzo         : toNumber(o.price),
          Valuta         : o.currency || body.currency,
          Peso_Kg        : toNumber(o.weight),
          Note_Operative : o.notes,
          Consigliata    : !!o.recommended,
        }
      }));
      await atCreate(TB_OPT, optRecords);
    }

    const url = `${PUBLIC_BASE}/quote/${encodeURIComponent(slug)}`;
    return res.status(200).json({ ok:true, id: quoteId, slug, url });
  } catch (err) {
    const status = err.status || 500;
    const details = err.payload || { message: err.message, name: err.name };
    console.error('[quotes/create] error:', details);
    return res.status(status).json({ ok:false, error: details });
  }
}
