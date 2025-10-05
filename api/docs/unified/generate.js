// api/docs/unified/generate.js
// COMPLETO — garantisce che per DLE generica (DHL/GLS/TNT/BRT) venga sempre
// passato ?carrier=<scelta UI> al renderer.

import crypto from 'node:crypto';
export const config = { runtime: 'nodejs' };

const SECRET = process.env.DOCS_SIGN_SECRET || '';

function makeSig(sid, type, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${sid}.${type}.${exp}`).digest('hex');
}
function canonical(params) {
  const keys = ['sid', 'type', 'exp', 'ship'];
  return keys
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

// normalizza il valore scelto in UI
function normCarrier(v='') {
  const s = String(v).trim();
  if (!s) return '';
  const m = s.toLowerCase();
  if (/^(usa|use).*(valore|value)|generico|altro|other$/.test(m)) return '';
  if (m === 'fx' || m === 'fedex') return 'FedEx';
  if (m === 'ups') return 'UPS';
  if (m === 'dhl') return 'DHL';
  if (m === 'gls') return 'GLS';
  if (m === 'tnt') return 'TNT';
  if (m === 'brt') return 'BRT';
  return s; // fallback (lascia com'è)
}

export default async function handler(req, res) {
  const now = new Date().toISOString();
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok:false, error:'Method Not Allowed' });
    }
    if (!SECRET) return res.status(500).json({ ok:false, error:'Missing DOCS_SIGN_SECRET' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idSpedizione = (body.idSpedizione || body.shipmentId || '').trim();
    const type = (body.type || 'proforma').trim(); // 'proforma' | 'commercial' | 'dle' | 'dle:ups' | 'dle:fedex'
    if (!idSpedizione) return res.status(400).json({ ok:false, error:'idSpedizione is required' });

    // firma
    const sid = idSpedizione;
    const ship = idSpedizione;
    const exp = Math.floor(Date.now()/1000) + 15*60;
    const sig = makeSig(sid, type, exp);

    // prendo la scelta UI da vari nomi possibili
    const chosenRaw =
      body.dleTpl || body.dle_template || body.template || body.dleTemplate ||
      body.carrier || body.courier || body.dleCarrier || '';
    const chosen = normCarrier(chosenRaw);

    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const base  = `${proto}://${host}`;

    // FedEx/UPS usano i template dedicati in /dle_html, il resto la DLE generica in /render
    const isDLE = type.toLowerCase().startsWith('dle');
    const isFedEx = chosen === 'FedEx' || type.toLowerCase().includes('dle:fedex');
    const isUPS   = chosen === 'UPS'   || type.toLowerCase().includes('dle:ups');
    const path = (isDLE && (isFedEx || isUPS)) ? '/api/docs/unified/dle_html' : '/api/docs/unified/render';

    const payload = { sid, type: 'dle'.startsWith(type.toLowerCase()) ? 'dle' : type, exp, ship };

    const extra = [];
    // ⬅️ Passo SEMPRE il carrier alla DLE generica
    if (path.endsWith('/render') && chosen) extra.push(`carrier=${encodeURIComponent(chosen)}`);
    // tengo anche il tpl per retrocompatibilità
    if (chosenRaw) extra.push(`tpl=${encodeURIComponent(String(chosenRaw))}`);

    const qs = canonical(payload) + `&sig=${sig}` + (extra.length ? `&${extra.join('&')}` : '');
    const url = `${base}${path}?${qs}`;

    return res.status(200).json({
      ok: true,
      url,
      field: 'Allegato DLE',
      type,
      via: 'referer',
    });
  } catch (err) {
    console.error('[generate] 500', now, err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
}
