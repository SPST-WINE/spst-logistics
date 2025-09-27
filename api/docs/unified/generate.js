// api/docs/unified/generate.js
// ESM: il progetto ha "type":"module" nel package.json
import crypto from 'node:crypto';

const SECRET = process.env.DOCS_SIGN_SECRET || '';

function makeSig(sid, type, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${sid}.${type}.${exp}`).digest('hex');
}

function canonical(params) {
  // Query ordinata (NON usata per la firma, solo per leggibilità)
  const keys = ['sid', 'type', 'exp', 'ship'];
  return keys
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

export default async function handler(req, res) {
  const now = new Date().toISOString();
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }
    if (!SECRET) {
      return res.status(500).json({ ok: false, error: 'Missing DOCS_SIGN_SECRET' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idSpedizione = (body.idSpedizione || '').trim();
    const type = (body.type || 'proforma').trim(); // 'proforma' | 'fattura' | 'dle'
    const carrier = (body.carrier || body.courier || '').toString().trim(); // pass-through opzionale (usato solo per proforma in render.js)
    if (!idSpedizione) {
      return res.status(400).json({ ok: false, error: 'idSpedizione is required' });
    }

    // Valori
    const sid = idSpedizione;  // firmato
    const ship = idSpedizione; // mostrato nel template

    const exp = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minuti
    const payload = { sid, type, exp, ship };
    const sig = makeSig(sid, type, exp);

    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;

    const qs = canonical(payload) + `&sig=${sig}` + (carrier ? `&carrier=${encodeURIComponent(carrier)}` : '');
    const url = `${base}/api/docs/unified/render?${qs}`;

    console.log('[generate] OK', { time: now, type, sid, ship, exp, carrier: carrier || null });

    const fieldMap = { proforma: 'Allegato Fattura', fattura: 'Allegato Fattura', dle: 'Allegato DLE' };

    return res.status(200).json({
      ok: true,
      url,
      field: fieldMap[type] || 'Allegato Fattura',
      type,
      via: 'referer',
    });
  } catch (err) {
    console.error('[generate] 500', now, err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

export const config = { runtime: "nodejs" };
