// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseCsv(v) {
  return String(v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function checkAuth(req) {
  const admin = (process.env.DOCS_ADMIN_KEY || '').trim();
  const hdrAdmin =
    (req.headers['x-admin-key'] && String(req.headers['x-admin-key'])) ||
    (req.headers.authorization && String(req.headers.authorization).replace(/^Bearer\s+/i, ''));

  if (admin && hdrAdmin && hdrAdmin === admin) {
    return { ok: true, how: 'header' };
  }

  const referer = String(req.headers.referer || '');
  const allowed = parseCsv(
    process.env.DOCS_UI_REFERERS
      || 'https://spst-logistics.vercel.app/api/tools/docs,https://spst-logistics-spsts-projects.vercel.app/api/tools/docs'
  );
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

function readJson(req){
  return new Promise((resolve, reject) => {
    let b=''; req.on('data', c => b+=c);
    req.on('end', () => { try{ resolve(b?JSON.parse(b):{});} catch(e){ reject(e); } });
    req.on('error', reject);
  });
}

function hmac(signingSecret, params) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', signingSecret).update(qs).digest('hex');
}

// ── Config env ────────────────────────────────────────────────────────────────
const TB    = process.env.TB_SPEDIZIONI || 'Spedizioni';
const BASE  = process.env.AIRTABLE_BASE_ID;
const PAT   = process.env.AIRTABLE_PAT;
const SIGN  = process.env.DOCS_SIGNING_SECRET;

// alias tipo → campo Airtable
const FIELD_BY_TYPE = {
  proforma: 'Allegato Proforma',
  pl:       'Allegato PL',
  dle:      'Allegato DLE',
  invoice:  'Allegato Fattura',
};

// sinonimi accettati dalla UI
const TYPE_ALIAS = {
  proforma: 'proforma',
  fattura:  'invoice',
  invoice:  'invoice',
  pl:       'pl',
  packing:  'pl',
  dle:      'dle',
};

export default async function handler(req, res){
  logReq(req, 'IN');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // Auth
  const auth = checkAuth(req);
  if (!auth.ok) {
    logReq(req, '401 Unauthorized');
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      hint: 'Apri da /api/tools/docs (vedi DOCS_UI_REFERERS) oppure usa X-Admin-Key',
    });
  }
  console.log('[docs/unified/generate] auth ok via', auth.how);

  // Controllo env indispensabili
  const missing = [];
  if (!BASE) missing.push('AIRTABLE_BASE_ID');
  if (!PAT)  missing.push('AIRTABLE_PAT');
  if (!SIGN) missing.push('DOCS_SIGNING_SECRET');
  if (missing.length){
    console.error('[docs/unified/generate] missing env', missing);
    return res.status(500).json({ ok:false, error:'Missing env: ' + missing.join(', ') });
  }

  try{
    const body = await readJson(req);
    const rawType = String(body?.type || 'proforma').toLowerCase();
    const normType = TYPE_ALIAS[rawType] || 'proforma';

    // accetto sia shipmentId che idSpedizione
    const shipmentId = body?.shipmentId || body?.idSpedizione || body?.id || body?.recId;
    console.log('[docs/unified/generate] payload', { rawType, normType, shipmentId });

    if (!shipmentId) {
      return res.status(400).json({ ok:false, error:'idSpedizione (o shipmentId) richiesto' });
    }

    const field = FIELD_BY_TYPE[normType] || FIELD_BY_TYPE.proforma;

    // URL firmato → /api/docs/unified/render
    const exp   = String(Math.floor(Date.now()/1000) + 60*10);
    const params = { sid: shipmentId, type: normType, exp };
    const sig   = hmac(SIGN, params);

    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url   = `${proto}://${host}/api/docs/unified/render?${new URLSearchParams({ ...params, sig })}`;

    // PATCH su Airtable
    const bodyAT = {
      records: [{ id: shipmentId, fields: { [field]: [{ url, filename: `${shipmentId}-${normType}.pdf` }] } }]
    };

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`, {
      method:'PATCH',
      headers:{ 'Authorization':`Bearer ${PAT}`, 'Content-Type':'application/json' },
      body: JSON.stringify(bodyAT)
    });
    const txt = await r.text();
    if (!r.ok){
      console.error('[docs/unified/generate] Airtable error', r.status, txt);
      throw new Error(`Airtable ${r.status}: ${txt}`);
    }

    console.log('[docs/unified/generate] OK', { field, url });
    return res.status(200).json({ ok:true, url, field, type:normType, how: auth.how });
  }catch(e){
    console.error('[docs/unified/generate] error', e);
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
