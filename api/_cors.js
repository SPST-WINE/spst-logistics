// Utility CORS comune ai nostri endpoint
const ALLOWLIST = (process.env.ORIGIN_ALLOWLIST || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

export function applyCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWLIST.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    // se non usi cookies/Authorization puoi togliere la riga sotto
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type, Authorization"
  );

  // Preflight OK, nessun body
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true; // handled
  }
  return false; // continue
}
