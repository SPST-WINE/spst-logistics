// api/quotes/create.js

// ===== CORS allowlist (domini autorizzati a chiamare l'API) =====
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

// ====== ENV / Airtable ======
const AT_BASE  = process.env.AIRTABLE_BASE_ID; // es: appXXXX
const AT_PAT   = process.env.AIRTABLE_PAT;     // token PAT
const TB_QUOTE = process.env.TB_PREVENTIVI;    // tabella preventivi
const TB_OPT   = process.env.TB_OPZIONI;       // tabella opzioni

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
    const msg  = json?.error?.message || JSON.stringify(json);
    const name = json?.error?.type    || 'AirtableError';
    const err  = new Error(msg);
    err.name   = name;
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// ===== Helpers =====
function toNumber(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function mapVisibility(v){
  // nel FE usiamo "Immediata" | "Solo_Bozza" (ma dall’UI può arrivare "Subito")
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (s.includes('subito') || s.includes('immediat')) return 'Immediata';
  if (s.includes('bozza')) return 'Solo_Bozza';
  return v;
}

function mapIncoterm(v){
  // consenti valori tipo EXW/DAP/DDP senza validazione rigida
  return v ? String(v).trim() : undefined;
}

function mapPayer(v){
  // 'Mittente' | 'Destinatario'
  return v ? String(v).trim() : undefined;
}

function yyyyMMdd(d){
  return d.toISOString().slice(0,10).replaceAll('-','');
}

function buildSlug(validUntil){
  // es: q-250826-2w95l
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth()+1).padStart(2,'0');
  const d = String(now.getDate()).padStart(2,'0');
  const alpha = '23456789abcdefghjkmnpqrstuvwxyz'; // niente 0/1/il confusi
  let rnd = '';
  for (let i=0;i<5;i++) rnd += alpha[Math.floor(Math.random()*alpha.length)];
  return `q-${y}${m}${d}-${rnd}`;
}

function addDays(date, days){
  const d = new Date(date);
  d.setDate(d.getDate() + (Number(days)||0));
  return d;
}

// ===== Handler =====
export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try {
    // sanity env
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error('Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI');
    }

    // body
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

    // calcoli termini/link
    const terms     = body.terms || {};
    const slug      = terms.slug && String(terms.slug).trim() ? terms.slug.trim() : buildSlug(body.validUntil);
    const visibility= mapVisibility(terms.visibility || 'Immediata');

    let linkExpiryDate = undefined;
    if (toNumber(terms.linkExpiryDays)) {
      const base = new Date(); // ora
      linkExpiryDate = addDays(base, terms.linkExpiryDays).toISOString().slice(0,10); // YYYY-MM-DD
    } else if (terms.linkExpiryDate) {
      // se il FE la calcola già
      try { linkExpiryDate = new Date(terms.linkExpiryDate).toISOString().slice(0,10); } catch {}
    }

    // ====== Creazione Preventivo ======
    const qFields = {
      // meta
      Email_Cliente    : body.customerEmail || undefined,
      Valuta           : body.currency || undefined,
      Valido_Fino_Al   : body.validUntil || undefined,
      Note_Globali     : body.notes || undefined,

      // mittente
      Mittente_Nome       : body.sender?.name,
      Mittente_Paese      : body.sender?.country,
      Mittente_Citta      : body.sender?.city,
      Mittente_CAP        : body.sender?.zip,
      Mittente_Indirizzo  : body.sender?.address,
      Mittente_Telefono   : body.sender?.phone,
      Mittente_Tax        : body.sender?.tax,   // <-- NOME CAMPO usato nella tua base

      // destinatario
      Destinatario_Nome       : body.recipient?.name,
      Destinatario_Paese      : body.recipient?.country,
      Destinatario_Citta      : body.recipient?.city,
      Destinatario_CAP        : body.recipient?.zip,
      Destinatario_Indirizzo  : body.recipient?.address,
      Destinatario_Telefono   : body.recipient?.phone,
      Destinatario_Tax        : body.recipient?.tax, // <-- NOME CAMPO usato nella tua base

      // termini / pubblicazione
      Versione_Termini  : terms.version || 'v1.0',
      Visibilita        : visibility,
      Slug_Pubblico     : slug,
      Scadenza_Link     : linkExpiryDate, // YYYY-MM-DD
    };

    const created = await atCreate(TB_QUOTE, [{ fields: qFields }]);
    const quoteId = created?.records?.[0]?.id;
    if (!quoteId) throw new Error('Quote created but no record id returned');

    // ====== Opzioni: link al preventivo appena creato ======
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    if (rawOptions.length) {
      const records = rawOptions.map(o => ({
        fields: {
          // Link record: **array di ID string**, non oggetti {id:...}
          Preventivo     : [quoteId],

          // NB: se "Indice" è un Autonumber in Airtable, NON inviarlo.
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

      // Airtable consente max 10 record per chiamata: qui in genere sono 1–2
      await atCreate(TB_OPT, records);
    }

    // URL pubblico (la pagina Webflow dovrà esistere /quote/[slug])
    const publicUrl = `https://www.spst.it/quote/${encodeURIComponent(slug)}`;

    return res.status(200).json({ ok:true, id: quoteId, slug, url: publicUrl });
  } catch (err) {
    const status  = err.status || 500;
    const details = err.payload || { name: err.name, message: err.message, stack: err.stack };
    console.error('[api/quotes/create] error:', details);
    return res.status(status).json({ ok:false, error: details });
  }
}
