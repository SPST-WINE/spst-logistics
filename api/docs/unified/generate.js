// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// AUTH & LOG MIDDLEWARE (incolla all'inizio di api/docs/unified/generate.js)
// ─────────────────────────────────────────────────────────────────────────────
function parseCsv(v) {
  return String(v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Accetta la richiesta se:
// - header X-Admin-Key (o Authorization: Bearer) = DOCS_ADMIN_KEY
// - OPPURE se il Referer inizia con uno dei valori in DOCS_UI_REFERERS (CSV)
//   es.: "https://spst-logistics.vercel.app/api/tools/docs,https://<preview>.vercel.app/api/tools/docs"
function checkAuth(req) {
  const admin = (process.env.DOCS_ADMIN_KEY || '').trim();
  const hdrAdmin =
    (req.headers['x-admin-key'] && String(req.headers['x-admin-key'])) ||
    (req.headers.authorization && String(req.headers.authorization).replace(/^Bearer\s+/i, ''));

  if (admin && hdrAdmin && hdrAdmin === admin) {
    return { ok: true, how: 'header' };
  }

  const referer = String(req.headers.referer || '');
  const allowed = parseCsv(process.env.DOCS_UI_REFERERS || 'https://spst-logistics.vercel.app/api/tools/docs');

  const byRef = allowed.some(p => referer.startsWith(p));
  if (byRef) return { ok: true, how: 'referer' };

  return { ok: false };
}

function logReq(req, note = '') {
  const safeHeaders = {
    host: req.headers.host,
    origin: req.headers.origin,
    referer: req.headers.referer,
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'user-agent': req.headers['user-agent'],
  };
  console.log('[docs/unified/generate]', note, {
    method: req.method,
    headers: safeHeaders,
    time: new Date().toISOString(),
  });
}

// Esempio di uso nel tuo handler:
export const config = { runtime: 'nodejs' }; // se non c'è già


const TB   = process.env.TB_SPEDIZIONI || 'Spedizioni';
const BASE = process.env.AIRTABLE_BASE_ID;
const PAT  = process.env.AIRTABLE_PAT;
const SIGN = process.env.DOCS_SIGNING_SECRET;
const ADMIN = process.env.DOCS_ADMIN_KEY || '';

const FIELD_BY_TYPE = {
  proforma: 'Allegato Proforma',
  pl: 'Allegato PL',
  dle: 'Allegato DLE',
  invoice: 'Allegato Fattura',
};

function hmac(params) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}

function readJson(req){
  return new Promise((resolve, reject) => {
    let b=''; req.on('data', c => b+=c);
    req.on('end', () => { try{ resolve(b?JSON.parse(b):{});} catch(e){ reject(e); } });
    req.on('error', reject);
  });
}

export default async function handler(req, res){
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  logReq(req, 'IN');

if (req.method !== 'POST') {
  res.setHeader('Allow', 'POST');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}

const auth = checkAuth(req);
if (!auth.ok) {
  logReq(req, '401 Unauthorized');
  return res.status(401).json({
    ok: false,
    error: 'Unauthorized',
    hint: 'Add X-Admin-Key or open from /api/tools/docs (see DOCS_UI_REFERERS)',
  });
}

// (opzionale) log payload "safe"
try {
  const bodySafe = typeof req.body === 'object' ? req.body : {};
  console.log('[docs/unified/generate] payload', {
    type: bodySafe?.type,
    idSpedizione: bodySafe?.idSpedizione,
    shipmentId: bodySafe?.shipmentId,
  });
} catch {}


  if (ADMIN && req.headers['x-admin-key'] !== ADMIN) {
    console.warn('[docs/generate] 401 missing/bad admin key');
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }

  try{
    const { shipmentId, type='proforma' } = await readJson(req);
    console.log('[docs/generate] body', { shipmentId, type });

    if (!shipmentId) return res.status(400).json({ ok:false, error:'shipmentId required' });

    const field = FIELD_BY_TYPE[type] || FIELD_BY_TYPE.proforma;
    const exp = String(Math.floor(Date.now()/1000) + 60*10);
    const params = { sid: shipmentId, type, exp };
    const sig = hmac(params);

    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${host}/api/docs/unified/render?${new URLSearchParams({ ...params, sig })}`;

    const body = {
      records: [{ id: shipmentId, fields: { [field]: [{ url, filename: `${shipmentId}-${type}.pdf` }] } }]
    };

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`, {
      method:'PATCH',
      headers:{ 'Authorization':`Bearer ${PAT}`, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    const txt = await r.text();
    if (!r.ok){
      console.error('[docs/generate] Airtable error', r.status, txt);
      throw new Error(`Airtable ${r.status}: ${txt}`);
    }

    console.log('[docs/generate] OK', { field, url });
    return res.status(200).json({ ok:true, url, field });
  }catch(e){
    console.error('[docs/generate] error', e);
    return res.status(500).json({ ok:false, error:String(e.message||e) });
  }
}
