// api/_lib/cors.js
const DEFAULT_ALLOW = [
  "http://localhost:3000",
  "https://*.vercel.app",
  "https://spst.it",
  "https://www.spst.it",
];

function parseAllowlist() {
  const raw = process.env.ORIGIN_ALLOWLIST || "";
  const envList = raw.split(",").map(s => s.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_ALLOW, ...envList])];
}

export function isOriginAllowed(origin, allowlist) {
  if (!origin) return true; // server-to-server
  try {
    const url = new URL(origin);
    const host = `${url.protocol}//${url.host}`;
    // wildcard support for *.vercel.app
    return allowlist.some((allowed) => {
      if (allowed.includes("*")) {
        const [proto, rest] = allowed.split("://");
        if (!proto || !rest) return false;
        if (proto + ":" !== url.protocol) return false;
        const re = new RegExp("^" + rest.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
        return re.test(url.host);
      }
      return allowed === host;
    });
  } catch {
    return false;
  }
}

export function withCors(handler) {
  const allowlist = parseAllowlist();
  return async (req, res) => {
    const origin = req.headers.origin;
    const allowed = isOriginAllowed(origin, allowlist);

    // Base headers
    if (allowed && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    if (!allowed) {
      res.status(403).json({ ok: false, error: "CORS: origin not allowed" });
      return;
    }

    return handler(req, res);
  };
}
