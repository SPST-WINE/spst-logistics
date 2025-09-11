// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Config da ENV
// ─────────────────────────────────────────────────────────────────────────────
const TB     = process.env.TB_SPEDIZIONI || 'Spedizioni';
const BASE   = process.env.AIRTABLE_BASE_ID || '';
const PAT    = process.env.AIRTABLE_PAT || '';
const SIGN   = process.env.DOCS_SIGNING_SECRET || '';
const ADMIN  = (process.env.DOCS_ADMIN_KEY || '').trim();
const IDFIELD = process.env.DOCS_ID_FIELD || 'ID Spedizione';

// Campo unico (se vuoi forzare tutti i tipi sullo stesso campo)
const FIELD_UNIFIED = (process.env.DOCS_FIELD_UNIFIED || '').trim();

// Campi per tipo (se definiti, hanno la precedenza su FIELD_UNIFIED)
const FIELD_BY_ENV = {
  proforma : (process.env.DOCS_FIELD_PROFORMA || '').trim(),
  fattura  : (process.env.DOCS_FIELD_FATTURA  || process.env.DOCS_FIELD_INVOICE || '').trim(),
  invoice  : (process.env.DOCS_FIELD_INVOICE  || process.env.DOCS_FIELD_FATTURA || '').trim(),
  dle      : (process.env.DOCS_FIELD_DLE      || '').trim(),
  pl       : (process.env.DOCS_FIELD_PL       || '').trim(),
};

// Fallback “di buon senso” se non c’è nulla in ENV
const FIELD_FALLBACK = {
  proforma: 'Allegato 1',
  fattura : 'Allegato Fattura',
  invoice : 'Allegato Fattura',
  dle     : 'Allegato DLE',
  pl      : 'Allegato PL',
};

// Referer consentiti (per l’UI utility)
function parseCsv(v) {
  return String(v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
const ALLOWED_REF = parseCsv(process.env.DOCS_UI_REFERERS || 'https://spst-logistics.vercel.app/api/tools/docs');

// ─────────────────────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────────────────────
function checkAuth(req) {
  // 1) Admin key via header
  const hdrAdmin =
    (req.headers['x-admin-key'] && String(req.headers['x-admin-key'])) ||
    (req.headers.authorization && String(req.headers.authorization).replace(/^Bearer\s+/i, ''));
  if (ADMIN && hdrAdmin && hdrAdmin === ADMIN) return { ok: true, how: 'header' };

  // 2) Oppure referer (UI utility page)
  const referer = String(req.headers.referer || '');
  const byRef = ALLOWED_REF.some(p => referer.startsWith(p));
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

async function findRecIdByIdSpedizione(idSped) {
  const formula = `({${IDFIELD}} = '${String(idSped).replace(/'/g, "\\'")}')`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: '1' });
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}?${qs}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${JSON.stringify(j)}`);
  const rec = Array.isArray(j.records) && j.records[0];
  return rec?.id || null;
}

function pickField(type) {
  // 1) per-tipo
  if (FIELD_BY_ENV[type]) return FIELD_BY_ENV[type];
  // 2) unified
  if (FIELD_UNIFIED) return FIELD_UNIFIED;
  // 3) fallback ragionevoli
  return FIELD_FALLBACK[type] || 'Allegato 1';
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res){
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  logReq(req, 'IN');

  // Auth
  const auth = checkAuth(req);
  if (!auth.ok) {
    logReq(req, '401 Unauthorized');
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      hint: 'Add X-Admin-Key or open from /api/tools/docs (see DOCS_UI_REFERERS)',
    });
  }

  try{
    // Body: accettiamo sia shipmentId (recXXXX) sia idSpedizione (stringa)
    const body = await readJson(req);
    const type = String(body?.type || 'proforma').toLowerCase();

    let recId = String(body?.shipmentId || '').trim();
    if (!recId) {
      const idSped = String(body?.idSpedizione || '').trim();
      if (!idSped) {
        return res.status(400).json({ ok:false, error:'shipmentId OR idSpedizione required' });
      }
      recId = await findRecIdByIdSpedizione(idSped);
      if (!recId) {
        return res.status(422).json({
          ok:false,
          error:'Airtable 422: il recordId è obbligatorio. Ho cercato tramite "ID Spedizione" ma non riesco a trovare il record.',
          hint:'Controlla che il campo "ID Spedizione" corrisponda esattamente; in alternativa passa shipmentId=recXXXX nel body.'
        });
      }
    }

    const field = pickField(type);

    // URL firmato per /render
    const exp = String(Math.floor(Date.now()/1000) + 60*10);
    const params = { sid: recId, type, exp };
    const sig = hmac(params);

    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${host}/api/docs/unified/render?${new URLSearchParams({ ...params, sig })}`;

    // Patch Airtable
    const bodyPatch = {
      records: [{ id: recId, fields: { [field]: [{ url, filename: `${recId}-${type}.pdf` }] } }]
    };
    const patch = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`, {
      method:'PATCH',
      headers:{ 'Authorization':`Bearer ${PAT}`, 'Content-Type':'application/json' },
      body: JSON.stringify(bodyPatch)
    });
    const txt = await patch.text();
    if (!patch.ok) {
      console.error('[docs/generate] Airtable error', patch.status, txt);
      return res.status(422).json({ ok:false, error:`Airtable ${patch.status}: ${txt}` });
    }

    console.log('[docs/generate] OK', { field, recId, type, via: auth.how });
    return res.status(200).json({ ok:true, url, field, recId, type, via: auth.how });
  }catch(e){
    console.error('[docs/generate] error', e);
    return res.status(500).json({ ok:false, error:String(e.message||e) });
  }
}
