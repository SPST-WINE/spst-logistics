// api/quotes/create.js

// ===== CORS allowlist (supporta wildcard tipo https://*.webflow.io) =====
const allowlist = (process.env.ORIGIN_ALLOWLIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowed(origin){
  if (!origin) return false;
  for (const item of allowlist){
    if (item.includes('*')){
      const esc = item.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*');
      if (new RegExp('^' + esc + '$').test(origin)) return true;
    } else if (item === origin){
      return true;
    }
  }
  return false;
}
function setCors(res, origin){
  if (isAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ===== Airtable env =====
const AT_BASE = process.env.AIRTABLE_BASE_ID;    // es. appxxxx
const AT_PAT  = process.env.AIRTABLE_PAT;        // token PAT
const TB_QUOTE= process.env.TB_PREVENTIVI;       // "Preventivi"
const TB_OPT  = process.env.TB_OPZIONI;          // "OpzioniPreventivo"

// ===== helpers HTTP Airtable =====
async function atCreate(table, records){
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method:'POST',
    headers:{ Authorization:`Bearer ${AT_PAT}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ records })
  });
  const json = await resp.json();
  if (!resp.ok){
    const err = new Error(json?.error?.message || 'Airtable create error');
    err.name = json?.error?.type || 'AirtableError';
    err.status = resp.status; err.payload = json;
    throw err;
  }
  return json;
}
async function atUpdate(table, id, fields){
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}/${id}`;
  const resp = await fetch(url, {
    method:'PATCH',
    headers:{ Authorization:`Bearer ${AT_PAT}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ fields })
  });
  const json = await resp.json();
  if (!resp.ok){
    const err = new Error(json?.error?.message || 'Airtable update error');
    err.name = json?.error?.type || 'AirtableError';
    err.status = resp.status; err.payload = json;
    throw err;
  }
  return json;
}
function chunk(arr, size=10){
  const out=[]; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out;
}

// ===== value mapping helpers =====
function mapVisibility(v){
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (s.includes('immediat') || s === 'subito') return 'Immediata';
  if (s.includes('bozza')) return 'Solo_Bozza';
  return v;
}
function mapIncoterm(v){ return v || undefined; }
function mapPayer(v){ return v || undefined; }
function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }
function computeExpiryDate(days){
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return undefined;
  const now = new Date();
  now.setDate(now.getDate() + d);
  return now.toISOString(); // Airtable Date/Time
}

// ===== handler ==============================================================
export default async function handler(req, res){
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try {
    // sanity env
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT){
      throw new Error('Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI');
    }

    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const isDraft = !!body.isDraft;
    let   quoteId = body.id || null;

    // best option index (se selezionata)
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    const best = rawOptions.find(o => !!o.recommended);
    const bestIndex = best?.index || undefined;

    // scadenza link se pubblicato
    const linkExpiry =
      body.terms?.linkExpiryDate ||
      computeExpiryDate(body.terms?.linkExpiryDays);

    // ===== campi Preventivo (mappati sui tuoi nomi) =======================
    const qFields = {
      // stato/visibilità
      Stato            : isDraft ? 'Bozza' : 'Pubblicato',
      Visibilita       : isDraft ? 'Solo_Bozza' : mapVisibility(body.terms?.visibility),
      Slug_Pubblico    : isDraft ? '' : (body.terms?.slug || ''),

      // dati front
      Email_Cliente    : body.customerEmail || undefined,
      Valuta           : body.currency || undefined,
      Valido_Fino_Al   : body.validUntil || undefined,
      Note_Globali     : body.notes || undefined,

      // mittente
      Mittente_Nome      : body.sender?.name,
      Mittente_Paese     : body.sender?.country,
      Mittente_Citta     : body.sender?.city,
      Mittente_CAP       : body.sender?.zip,
      Mittente_Indirizzo : body.sender?.address,
      Mittente_Telefono  : body.sender?.phone,
      Mittente_Tax       : body.sender?.tax,

      // destinatario
      Destinatario_Nome      : body.recipient?.name,
      Destinatario_Paese     : body.recipient?.country,
      Destinatario_Citta     : body.recipient?.city,
      Destinatario_CAP       : body.recipient?.zip,
      Destinatario_Indirizzo : body.recipient?.address,
      Destinatario_Telefono  : body.recipient?.phone,
      Destinatario_Tax       : body.recipient?.tax,

      // termini
      Versione_Termini  : body.terms?.version || 'v1.0',
      Scadenza_Link     : !isDraft ? (linkExpiry || undefined) : undefined,

      // sintesi opzioni
      Opzione_Consigliata: bestIndex ? toNumber(bestIndex) : undefined,
    };

    // ===== crea/aggiorna Preventivo =======================================
    if (isDraft){
      if (quoteId) {
        await atUpdate(TB_QUOTE, quoteId, qFields);
      } else {
        const r = await atCreate(TB_QUOTE, [{ fields: qFields }]);
        quoteId = r.records?.[0]?.id;
      }
      return res.status(200).json({ ok:true, id: quoteId });
    }

    // pubblicazione
    if (quoteId) {
      await atUpdate(TB_QUOTE, quoteId, qFields);
    } else {
      const r = await atCreate(TB_QUOTE, [{ fields: qFields }]);
      quoteId = r.records?.[0]?.id;
    }
    if (!quoteId) throw new Error('Quote created but no record id returned');

    // ===== crea opzioni collegate (solo in pubblicazione) =================
    if (rawOptions.length){
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

      for (const batch of chunk(optRecords, 10)){
        await atCreate(TB_OPT, batch);
      }
    }

    return res.status(200).json({ ok:true, id: quoteId });
  } catch (err){
    const status = err.status || 500;
    const details = err.payload || { message: err.message, name: err.name };
    console.error('[quotes/create] error:', details);
    return res.status(status).json({ ok:false, error: details });
  }
}
