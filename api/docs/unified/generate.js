// api/docs/unified/generate.js
// ESM: il progetto ha "type":"module" nel package.json
import crypto from 'node:crypto';

const SECRET = process.env.DOCS_SIGN_SECRET || '';

function makeSig(sid, type, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${sid}.${type}.${exp}`).digest('hex');
}

function normalizeType(t) {
  const raw = String(t || 'proforma').toLowerCase().trim();
  const commercialAliases = new Set(['commercial', 'commerciale', 'invoice', 'fattura', 'fattura commerciale']);
  const dleAliases = new Set(['dle', 'dichiarazione', 'libera', 'esportazione', 'export', 'export declaration']);
  if (dleAliases.has(raw)) return 'dle';
  if (commercialAliases.has(raw)) return 'commercial';
  return 'proforma';
}

function canonical(params) {
  // Query ordinata (NON usata per la firma, solo per leggibilità)
  const keys = ['sid', 'type', 'exp', 'ship', 'format', 'carrier'];
  return keys
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
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

    // Body
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idSpedizione = (body.idSpedizione || body.shipmentId || '').trim();
    const rawType = (body.type || 'proforma').trim(); // 'proforma' | 'commercial' | 'dle'
    const type = normalizeType(rawType);
    const carrier = (body.carrier || body.courier || '').toString().trim().toLowerCase(); // 'fedex' | 'ups'
    const formatIn = (body.format || '').toString().trim().toLowerCase();                 // 'pdf' per DLE template

    if (!idSpedizione) {
      return res.status(400).json({ ok: false, error: 'idSpedizione is required' });
    }

    // Valori base
    const sid = idSpedizione;  // firmato
    const ship = idSpedizione; // mostrato nel template
    const exp = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minuti
    const sig = makeSig(sid, type, exp);

    // Costruzione URL
    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;

    // Se DLE + (format=pdf oppure carrier valido) ⇒ forza PDF con template del corriere
    let format = '';
    let carrierParam = '';
    if (type === 'dle') {
      const hasCarrier = carrier === 'fedex' || carrier === 'ups';
      if (formatIn === 'pdf' || hasCarrier) {
        format = 'pdf';
        if (hasCarrier) carrierParam = carrier;
      }
    }

    const payload = { sid, type, exp, ship, ...(format ? { format } : {}), ...(carrierParam ? { carrier: carrierParam } : {}) };
    const qs = canonical(payload) + `&sig=${sig}`;
    const url = `${base}/api/docs/unified/render?${qs}`;

    const fieldMap = { proforma: 'Allegato Fattura', commercial: 'Allegato Fattura', dle: (format ? 'Allegato DLE PDF' : 'Allegato DLE') };

    console.log('[generate] OK', { time: now, type, sid, ship, exp, format: format || 'html', carrier: carrierParam || null });

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
