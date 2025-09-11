// api/back-office/[...path].js
// Espone gli asset del Back Office: legge prima da /public/back-office (bundle incluso),
// poi fallback ai percorsi sorgente (back-office/*.css e assets/esm/*).

import { promises as fs } from "fs";
import path from "path";

export const config = { runtime: "nodejs" };

const ROOT = process.cwd();

function ctype(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".js" || ext === ".mjs") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json" || ext === ".map") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

export default async function handler(req, res) {
  // CORS per Webflow
  res.setHeader("Access-Control-Allow-Origin", "https://www.spst.it");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    let rel = url.pathname.replace(/^\/api\/back-office\/?/, "");
    rel = decodeURIComponent(rel).replace(/^\/+/, ""); // es. "main.js"

    if (!rel || rel.includes("..")) return res.status(400).send("Bad Request");

    // 1) PRIMA cerca nell'output generato dal postinstall (che bundle-izziamo con includeFiles)
    const fromPublic = path.join(ROOT, "public", "back-office", rel);

    // 2) Fallback: sorgenti (utile in locale)
    const fromCssSrc = path.join(ROOT, "back-office", rel);       // base.css, quotes-admin.css
    const fromEsmSrc = path.join(ROOT, "assets", "esm", rel);     // main.js, ecc.

    const candidates = [fromPublic, fromCssSrc, fromEsmSrc];

    let found = null;
    for (const p of candidates) {
      try {
        const st = await fs.stat(p);
        if (st.isFile()) { found = p; break; }
      } catch {}
    }

    if (!found) return res.status(404).send("Not Found");

    const buf = await fs.readFile(found);
    res.setHeader("Content-Type", ctype(found));
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).end(buf);
  } catch (e) {
    console.error("back-office static error", e);
    return res.status(500).send("Internal Error");
  }
}
