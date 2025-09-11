// ─────────────────────────────────────────────────────────────────────────────
// AUTH & LOG MIDDLEWARE (incolla all'inizio di api/docs/unified/generate.js)
// ─────────────────────────────────────────────────────────────────────────────
function parseCsv(v) {
  return String(v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Accetta la richiesta se:
// - header X-Admin-Key (o Authorization: Bearer) = DOCS_ADMIN_KEY
// - OPPURE se il Referer inizia con uno dei valori in DOCS_UI_REFERERS (CSV)
//   es.: "https://spst-logistics.vercel.app/api/tools/docs,https://<preview>.vercel.app/api/tools/docs"
function checkAuth(req) {
  const admin = (process.env.DOCS_ADMIN_KEY || '').trim();
  const hdrAdmin =
    (req.headers['x-admin-key'] && String(req.headers['x-admin-key'])) ||
    (req.headers.authorization && String(req.headers.authorization).replace(/^Bearer\s+/i, ''));

  if (admin && hdrAdmin && hdrAdmin === admin) {
    return { ok: true, how: 'header' };
  }

  const referer = String(req.headers.referer || '');
  const allowed = parseCsv(process.env.DOCS_UI_REFERERS || 'https://spst-logistics.vercel.app/api/tools/docs');

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

// Esempio di uso nel tuo handler:
export const config = { runtime: 'nodejs' }; // se non c'è già
