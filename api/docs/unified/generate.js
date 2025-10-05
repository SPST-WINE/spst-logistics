// api/docs/unified/generate.js
// SOSTITUISCI INTERO FILE. Per i DLE passa all'endpoint HTML “dle_html”.

import crypto from 'node:crypto';
export const config = { runtime: 'nodejs' };

const SECRET = process.env.DOCS_SIGN_SECRET || '';

function makeSig(sid, type, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${sid}.${type}.${exp}`).digest('hex');
}
function canonical(params) {
  const keys = ['sid', 'type', 'exp', 'ship'];
  return keys.filter(k => params[k]!==undefined && params[k]!==null)
             .map(k => `${k}=${encodeURIComponent(String(params[k]))}`).join('&');
}
function routePathForType(type) {
  const t = String(type || '').toLowerCase();
  if (t.startsWith('dle')) return '/api/docs/unified/dle_html'; // ➜ HTML template
  return '/api/docs/unified/render';                             // ➜ proforma/commercial
}

export default async function handler(req, res) {
  const now = new Date().toISOString();
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok:false, error:'Method Not Allowed' });
    }
    if (!SECRET) return res.status(500).json({ ok:false, error:'Missing DOCS_SIGN_SECRET' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body||{});
    const idSpedizione = (body.idSpedizione || body.shipmentId || '').trim();
    const type = (body.type || 'proforma').trim();
    const carrier = (body.carrier || '').toString().trim();
    if (!idSpedizione) return res.status(400).json({ ok:false, error:'idSpedizione is required' });

    const sid = idSpedizione;
    const ship = idSpedizione;
    const exp = Math.floor(Date.now()/1000) + 15*60;
    const payload = { sid, type, exp, ship };
    const sig = makeSig(sid, type, exp);

    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;

    const path = routePathForType(type);
    const qs = canonical(payload) + `&sig=${sig}` + (carrier ? `&carrier=${encodeURIComponent(carrier)}` : '');
    const url = `${base}${path}?${qs}`;

    console.log('[generate] OK', { time: now, type, sid, path });

    const fieldMap = {
      proforma: 'Allegato Fattura',
      fattura:  'Allegato Fattura',
      commercial: 'Allegato Fattura',
      dle:      'Allegato DLE',
      'dle:fedex': 'Allegato DLE',
      'dle:ups':   'Allegato DLE',
    };

    return res.status(200).json({
      ok: true,
      url,
      field: fieldMap[type.toLowerCase()] || 'Allegato Fattura',
      type,
      via: 'referer',
    });
  } catch (err) {
    console.error('[generate] 500', now, err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
}
