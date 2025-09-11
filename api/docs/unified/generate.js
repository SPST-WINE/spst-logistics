// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

const TB        = process.env.TB_SPEDIZIONI || 'Spedizioni';
const BASE      = process.env.AIRTABLE_BASE_ID;
const PAT       = process.env.AIRTABLE_PAT;
const SIGN      = process.env.DOCS_SIGNING_SECRET || '';
const ADMIN     = process.env.DOCS_ADMIN_KEY || '';
const PUBLIC    = (process.env.PUBLIC_BASE_URL || '').trim(); // es. https://spst-logistics-spsts-projects.vercel.app

// Mappa campi (override via env DOCS_FIELD_UNIFIED se usi un unico campo)
const FIELD_BY_TYPE_ENV = (process.env.DOCS_FIELD_UNIFIED || '').trim();
const FIELD_BY_TYPE = FIELD_BY_TYPE_ENV ? {
  proforma: FIELD_BY_TYPE_ENV,
  fattura:  FIELD_BY_TYPE_ENV,
  invoice:  FIELD_BY_TYPE_ENV,
  dle:      FIELD_BY_TYPE_ENV,
  pl:       FIELD_BY_TYPE_ENV,
} : {
  proforma: 'Allegato Proforma',
  fattura:  'Allegato Fattura',
  invoice:  'Allegato Fattura',
  dle:      'Allegato DLE',
  pl:       'Allegato PL',
};

function log(note, extra = {}) {
  console.log('[docs/unified/generate]', note, { ...extra, t: new Date().toISOString() });
}
function hmac(params) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}
function parseCsv(v) {
  return String(v || '').split(',').map(s=>s.trim()).filter(Boolean);
}
function checkAuth(req) {
  // 1) Header X-Admin-Key / Bearer
  const admin = ADMIN;
  const hdr =
    (req.headers['x-admin-key'] && String(req.headers['x-admin-key'])) ||
    (req.headers.authorization && String(req.headers.authorization).replace(/^Bearer\s+/i, ''));
  if (admin && hdr && hdr === admin) return { ok:true, how:'header' };

  // 2) Referer ammessi
  const referer = String(req.headers.referer || '');
  const allow = parseCsv(process.env.DOCS_UI_REFERERS || 'https://spst-logistics-spsts-projects.vercel.app/api/tools/docs');
  if (allow.some(p => referer.startsWith(p))) return { ok:true, how:'referer' };

  return { ok:false };
}

async function readJson(req){
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve,reject)=>{
    let b=''; req.on('data',c=>b+=c);
    req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{});} catch(e){ reject(e);} });
    req.on('error',reject);
  });
}

async function findRecordIdByShipmentId(idSpedizione) {
  // Cerca per formula: {ID Spedizione}="..."
  const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`);
  url.searchParams.set('maxRecords', '1');
  url.searchParams.set('pageSize', '1');
  url.searchParams.set('filterByFormula', `{ID Spedizione}="${idSpedizione.replace(/"/g,'\\"')}"`);

  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` }});
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(`Airtable search ${r.status}: ${JSON.stringify(j)}`);
  const rec = (j.records && j.records[0]) || null;
  return rec ? rec.id : null;
}

export default async function handler(req, res){
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  log('IN', {
    method: req.method,
    headers: {
      host: req.headers.host, origin: req.headers.origin, referer: req.headers.referer,
      'x-forwarded-for': req.headers['x-forwarded-for'], 'user-agent': req.headers['user-agent'],
    }
  });

  const auth = checkAuth(req);
  if (!auth.ok) {
    log('401 Unauthorized');
    return res.status(401).json({ ok:false, error:'Unauthorized', hint:'X-Admin-Key o Referer ammesso' });
  }

  try{
    const body = await readJson(req);
    // accettiamo sia shipmentId (recXXXX) sia idSpedizione (campo Airtable)
    let { shipmentId, idSpedizione, type='proforma' } = body || {};
    type = String(type || 'proforma').toLowerCase();

    if (!shipmentId && idSpedizione) {
      shipmentId = await findRecordIdByShipmentId(String(idSpedizione).trim());
      if (!shipmentId) {
        const msg = `Airtable 422: il recordId è obbligatorio. Ho cercato tramite "ID Spedizione" ma non riesco a patchare.`;
        log('ERR findRecordId', { idSpedizione });
        return res.status(422).json({ ok:false, error: msg, hint:'Verifica "ID Spedizione"; in alternativa invia shipmentId=recXXXX' });
      }
    }

    if (!shipmentId) {
      return res.status(400).json({ ok:false, error:'shipmentId (recXXXX) o idSpedizione richiesto' });
    }

    const field = FIELD_BY_TYPE[type] || FIELD_BY_TYPE.proforma;

    // Costruisci URL firmato verso render
    const exp = String(Math.floor(Date.now()/1000) + 60*10);
    const params = { sid: shipmentId, type, exp };
    const sig = hmac(params);
    const baseUrl =
      PUBLIC ||
      `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const url = `${baseUrl}/api/docs/unified/render?${new URLSearchParams({ ...params, sig })}`;

    // ── Sanity check: HEAD (e fallback GET) all’URL di render, con log dettagliati
    let headStatus = 0, headLen = undefined, headType = undefined;
    try{
      const rH = await fetch(url, { method:'HEAD', cache:'no-store' });
      headStatus = rH.status;
      headLen = rH.headers.get('content-length');
      headType = rH.headers.get('content-type');
      log('HEAD render', { status: headStatus, len: headLen, type: headType });
      if (headStatus !== 200) {
        const rG = await fetch(url, { method:'GET', cache:'no-store' });
        log('GET render (fallback)', { status: rG.status, type: rG.headers.get('content-type'), len: rG.headers.get('content-length') });
        if (!rG.ok) {
          const txt = await rG.text().catch(()=> '');
          return res.status(502).json({ ok:false, error:`Render endpoint ${rG.status}`, details: txt.slice(0,600) });
        }
      }
    }catch(e){
      log('ERR render precheck', { e: String(e?.message || e) });
      return res.status(502).json({ ok:false, error:'Render unreachable', details: String(e?.message || e) });
    }

    // Patch su Airtable
    const bodyPatch = {
      records: [{
        id: shipmentId,
        fields: { [field]: [{ url, filename: `${shipmentId}-${type}.pdf` }] }
      }]
    };

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`, {
      method:'PATCH',
      headers:{ 'Authorization':`Bearer ${PAT}`, 'Content-Type':'application/json' },
      body: JSON.stringify(bodyPatch)
    });
    const txt = await r.text();
    if (!r.ok){
      log('ERR Airtable patch', { status: r.status, txt: txt.slice(0,800) });
      return res.status(r.status).json({ ok:false, error:`Airtable ${r.status}: ${txt}` });
    }

    log('OK', { field, recId: shipmentId, type, via: auth.how });
    return res.status(200).json({ ok:true, url, field, recId: shipmentId, type, via: auth.how });
  }catch(e){
    log('ERR 500', { e: String(e?.message || e) });
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
