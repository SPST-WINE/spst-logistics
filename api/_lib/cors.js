// CORS helper: legge CORS_ALLOWLIST o ORIGIN_ALLOWLIST
const raw =
  process.env.CORS_ALLOWLIST ||
  process.env.ORIGIN_ALLOWLIST ||
  "";

const allowlist = raw.split(",").map(s => s.trim()).filter(Boolean);

export function withCORS(handler) {
  return async (req, res) => {
    const origin = req.headers.origin || "";
    if (allowlist.length && origin && allowlist.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.status(200).end(); return; }
    return handler(req, res);
  };
}
