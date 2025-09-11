// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────
// ENV
// ─────────────────────────────────────────────────────────────
const TB   = process.env.TB_SPEDIZIONI || 'Spedizioni';
const BASE = process.env.AIRTABLE_BASE_ID;
const PAT  = process.env.AIRTABLE_PAT;
const SIGN = process.env.DOCS_SIGNING_SECRET || '';        // opzionale per token HMAC
const ADMIN = (process.env.DOCS_ADMIN_KEY || '').trim();   // opzionale
const UI_REFERERS = (process.env.DOCS_UI_REFERERS || 'https://spst-logistics.vercel.app/api/tools/docs')
  .split(',').map(s => s.trim()).filter(Boolean);

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
function log(tag, info){ console.log(`[docs/unified/generate] ${tag}`, info || ''); }
function err(tag, info){ console.error(`[docs/unified/generate] ${tag}`, info || ''); }

function hmacToken(params){
  if (!SIGN) return '';
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

function isRecId(s){ return /^rec[0-9A-Za-z]{14}/.test(String(s||'')); }

// Cerca il recordId a partire dall'ID Spedizione (campo Airtable)
async function findRecordIdByBusinessId(idSped){
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}?${new URLSearchParams({
    maxRecords: '1',
    filterByFormula: `{ID Spedizione} = "${idSped.replace(/"/g,'\\"')}"`
  })}`;

  log('FIND url', url);
  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${PAT}` }
  });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok){
    err('FIND airtable non-ok', { status: r.status, body: j });
    throw new Error(`Airtable find ${r.status}`);
  }
  const rec = Array.isArray(j.records) && j.records[0];
  return rec ? rec.id : null;
}

function checkAuth(req){
  // 1) Header X-Admin-Key / Bearer
  const hdrAdmin =
    (req.headers['x-admin-key'] && String(req.headers['x-admin-key'])) ||
    (req.headers.authorization && String(req.headers.authorization).replace(/^Bearer\s+/i, ''));
  if (ADMIN && hdrAdmin && hdrAdmin === ADMIN) return { ok: true, how: 'header' };

  // 2) Referer
  const ref = String(req.headers.referer || '');
  const okRef = UI_REFERERS.some(p => ref.startsWith(p));
  if (okRef) return { ok: true, how: 'referer' };

  return { ok:false, why:'auth' };
}

// Campo allegato per tipo documento
const FIELD_BY_TYPE = {
  proforma: 'Allegato Proforma',
  fattura:  'Allegato Fattura',
  invoice:  'Allegato Fattura', // alias
  dle:      'Allegato DLE',
  pl:       'Allegato PL',
};

// ─────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res){
  const safeHeaders = {
    host: req.headers.host,
    origin: req.headers.origin,
    referer: req.headers.referer,
    'user-agent': req.headers['user-agent'],
  };
  log('IN', { method: req.method, headers: safeHeaders, time: new Date().toISOString() });

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  // Auth
  const auth = checkAuth(req);
  if (!auth.ok){
    err('401', { reason:'auth-failed', headers: safeHeaders });
    return res.status(401).json({
      ok:false,
      error:'Unauthorized',
      hint:'Add X-Admin-Key or open from a referer listed in DOCS_UI_REFERERS',
    });
  }

  let body;
  try{
    body = await readJson(req);
  }catch(e){
    err('bad-json', e);
    return res.status(400).json({ ok:false, error:'Invalid JSON body' });
  }

  const rawIdSped = (body.idSpedizione || '').trim();
  const rawSid    = (body.shipmentId   || '').trim();
  const type      = (body.type || 'proforma').toLowerCase();

  log('payload', { idSpedizione: rawIdSped, shipmentId: rawSid, type });

  if (!BASE || !PAT){
    err('env-missing', { BASE:!!BASE, PAT:!!PAT });
    return res.status(500).json({ ok:false, error:'Server not configured (AIRTABLE_BASE_ID/AIRTABLE_PAT)' });
  }

  // 1) Determina recordId Airtable
  let recordId = null;

  if (rawSid && isRecId(rawSid)) {
    recordId = rawSid;
  } else if (rawIdSped) {
    // l'utente ha immesso "ID Spedizione": cerca il recId
    try{
      recordId = await findRecordIdByBusinessId(rawIdSped);
    }catch(e){
      err('find-error', e);
      return res.status(502).json({ ok:false, error:'Airtable search failed' });
    }
    if (!recordId){
      return res.status(404).json({ ok:false, error:`Nessun record trovato per ID Spedizione "${rawIdSped}"` });
    }
  } else {
    return res.status(400).json({ ok:false, error:'Fornisci idSpedizione (ID Spedizione) o shipmentId (rec…) nel body' });
  }

  const field = FIELD_BY_TYPE[type] || FIELD_BY_TYPE.proforma;

  try{
    // 2) Costruisci URL del renderer
    const exp = String(Math.floor(Date.now()/1000) + 60*10); // 10m
    const params = { shipmentId: recordId, type, exp };
    const token = SIGN ? hmacToken(params) : '';
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${host}/api/docs/unified/render?${new URLSearchParams({ ...params, token }).toString()}`;

    log('render-url', { url, field, recordId });

    // 3) PATCH su Airtable: allega l’URL firmato
    const bodyPatch = {
      records: [{
        id: recordId,
        fields: { [field]: [{ url, filename: `${rawIdSped || recordId}-${type}.pdf` }] }
      }]
    };

    const patchUrl = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`;
    const r = await fetch(patchUrl, {
      method:'PATCH',
      headers:{
        'Authorization': `Bearer ${PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyPatch)
    });

    const txt = await r.text();
    if (!r.ok){
      err('airtable-patch', { status:r.status, txt });
      // Messaggio più chiaro in caso di ID Spedizione passato al posto di recId
      if (r.status === 422 && !isRecId(rawSid) && rawIdSped) {
        return res.status(422).json({
          ok:false,
          error:'Airtable 422: il recordId è obbligatorio. Ho cercato tramite "ID Spedizione" ma non riesco a patchare.',
          hint:'Controlla che il campo "ID Spedizione" corrisponda esattamente; in alternativa passa shipmentId=recXXXX nel body.'
        });
      }
      throw new Error(`Airtable ${r.status}: ${txt}`);
    }

    log('OK', { recordId, field });
    return res.status(200).json({ ok:true, recordId, field, url });
  }catch(e){
    err('fatal', e);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
}
