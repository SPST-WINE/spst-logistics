// /api/airtable/cors-debug.js
export default async function handler(req, res){
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();

  return res.status(200).json({
    ok: true,
    method: req.method,
    origin: req.headers.origin || null,
    hint: "Se vedi questa risposta dal browser, i CORS sono ok lato piattaforma."
  });
}
