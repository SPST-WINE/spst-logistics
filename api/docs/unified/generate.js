// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

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

  // Guard opzionale
  if (ADMIN && req.headers['x-admin-key'] !== ADMIN) {
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }

  try{
    const { shipmentId, type='proforma' } = await readJson(req);
    if (!shipmentId) return res.status(400).json({ ok:false, error:'shipmentId required' });

    const field = FIELD_BY_TYPE[type] || FIELD_BY_TYPE.proforma;
    const exp = String(Math.floor(Date.now()/1000) + 60*10); // 10 minuti
    const params = { sid: shipmentId, type, exp };
    const sig = hmac(params);

    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${host}/api/docs/unified/render?${new URLSearchParams({ ...params, sig })}`;

    // Patch allegato su Airtable (Airtable scarica il PDF e lo internalizza)
    const body = {
      records: [{
        id: shipmentId,
        fields: { [field]: [{ url, filename: `${shipmentId}-${type}.pdf` }] }
      }]
    };

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`, {
      method:'PATCH',
      headers:{
        'Authorization':`Bearer ${PAT}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok){
      const t = await r.text().catch(()=> '');
      throw new Error(`Airtable ${r.status}: ${t}`);
    }

    return res.status(200).json({ ok:true, url, field });
  }catch(e){
    console.error('[docs/generate] error', e);
    return res.status(500).json({ ok:false, error:String(e.message||e) });
  }
}
