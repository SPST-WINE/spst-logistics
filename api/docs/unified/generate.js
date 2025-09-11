// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

/* ───────────── ENV ───────────── */
const TB   = process.env.TB_SPEDIZIONI || 'Spedizioni';
const BASE = process.env.AIRTABLE_BASE_ID;
const PAT  = process.env.AIRTABLE_PAT;
const SIGN = process.env.DOCS_SIGNING_SECRET || '';           // opzionale per token HMAC
const ADMIN = (process.env.DOCS_ADMIN_KEY || '').trim();      // opzionale
const UI_REFERERS = (process.env.DOCS_UI_REFERERS || 'https://spst-logistics.vercel.app/api/tools/docs')
  .split(',').map(s => s.trim()).filter(Boolean);

/* ───────────── UTILS ───────────── */
const FIELD_BY_TYPE = {
  proforma: 'Allegato Proforma',
  fattura:  'Allegato Fattura',
  invoice:  'Allegato Fattura', // alias
  dle:      'Allegato DLE',
  pl:       'Allegato PL',
};

function log(tag, info){ console.log(`[docs/unified/generate] ${tag}`, info ?? ''); }
function err(tag, info){ console.error(`[docs/unified/generate] ${tag}`, info ?? ''); }

function hmacToken(params){
  if (!SIGN) return '';
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}
function isRecId(s){ return /^rec[0-9A-Za-z]{14}/.test(String(s||'')); }

function readJson(req){
  return new Promise((resolve, reject) => {
    let b=''; req.on('data', c => b+=c);
    req.on('end', () => { try{ resolve(b?JSON.parse(b):{});} catch(e){ reject(e); } });
    req.on('error', reject);
  });
}

async function findRecordIdByBusinessId(idSped){
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}?` +
    new URLSearchParams({
      maxRecords: '1',
      filterByFormula: `{ID Spedizione} = "${String(idSped).replace(/"/g,'\\"')}"`
    });
  log('FIND url', url);
  const r = await fetch(url, { headers: { 'Authorization': `Bearer ${PAT}` } });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok){
    err('FIND not-ok', { status:r.status, body:j });
    throw new Error(`Airtable find ${r.status}`);
  }
  const rec = Array.isArray(j.records) && j.records[0];
  return rec ? rec.id : null;
}

function checkAuth(req){
  const hdrAdmin =
    (req.headers['x-admin-key'] && String(req.headers['x-admin-key'])) ||
    (req.headers.authorization && String(req.headers.authorization).replace(/^Bearer\s+/i, ''));
  if (ADMIN && hdrAdmin && hdrAdmin === ADMIN) return { ok:true, how:'header' };

  const ref = String(req.headers.referer || '');
  if (UI_REFERERS.some(p => ref.startsWith(p))) return { ok:true, how:'referer' };

  return { ok:false };
}

/* ───────────── HANDLER ───────────── */
export default async function handler(req, res){
  const safeHeaders = {
    host: req.headers.host, origin: req.headers.origin, referer: req.headers.referer,
    'user-agent': req.headers['user-agent']
  };
  log('IN', { method:req.method, headers:safeHeaders, time:new Date().toISOString() });

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  // Auth soft: header oppure referer whitelisted
  const auth = checkAuth(req);
  if (!auth.ok){
    err('401 auth', safeHeaders);
    return res.status(401).json({
      ok:false, error:'Unauthorized',
      hint:'Aggiungi X-Admin-Key oppure apri dalla pagina utility in DOCS_UI_REFERERS'
    });
  }

  if (!BASE || !PAT){
    err('env-missing', { BASE:!!BASE, PAT:!!PAT });
    return res.status(500).json({ ok:false, error:'Server non configurato (AIRTABLE_BASE_ID/AIRTABLE_PAT)' });
  }

  let body;
  try{ body = await readJson(req); }catch(e){
    err('bad-json', e);
    return res.status(400).json({ ok:false, error:'Invalid JSON body' });
  }

  const rawIdSped = (body.idSpedizione || '').trim();
  const rawSid    = (body.shipmentId   || '').trim();
  const type      = (body.type || 'proforma').toLowerCase();
  const field     = FIELD_BY_TYPE[type] || FIELD_BY_TYPE.proforma;

  log('payload', { idSpedizione:rawIdSped, shipmentId:rawSid, type, field });

  // 1) Risolvi il recordId (Airtable) a partire da idSpedizione o shipmentId=rec…
  let recordId = null;
  if (rawSid && isRecId(rawSid)) {
    recordId = rawSid;
  } else if (rawIdSped) {
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
    return res.status(400).json({ ok:false, error:'Fornisci idSpedizione (ID Spedizione) o shipmentId (rec...)' });
  }

  try{
    // 2) Costruisci URL del renderer
    const exp   = String(Math.floor(Date.now()/1000) + 60*10); // 10 min
    const params= { shipmentId: recordId, type, exp };
    const token = SIGN ? hmacToken(params) : '';
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url   = `${proto}://${host}/api/docs/unified/render?` +
      new URLSearchParams({ ...params, token }).toString();

    log('render-url', { url, recordId, field });

    // 3) PATCH **single-record** (niente array): /{table}/{recordId}
    const patchUrl = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}/${recordId}`;
    const bodyPatch = { fields: { [field]: [{ url, filename: `${rawIdSped || recordId}-${type}.pdf` }] } };

    log('PATCH', { patchUrl, bodyPatch });

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
      return res.status(r.status).json({
        ok:false,
        error:`Airtable ${r.status}: ${txt}`,
        hint: r.status === 422
          ? 'Controlla che il campo esista ed accetti allegati; in alternativa prova con shipmentId=recXXXX'
          : undefined
      });
    }

    log('OK', { recordId, field });
    return res.status(200).json({ ok:true, recordId, field, url });
  }catch(e){
    err('fatal', e);
    return res.status(500).json({ ok:false, error:String(e.message||e) });
  }
}
