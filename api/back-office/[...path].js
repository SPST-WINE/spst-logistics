// api/back-office/[...path].js
// Serve gli asset del Back Office: JS da /assets/esm e CSS da /back-office

import { promises as fs } from "fs";
import path from "path";

export const config = { runtime: "nodejs" };

const ROOT = process.cwd();

function contentType(p) {
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
    // Estrai il path richiesto direttamente da req.url
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    let rel = url.pathname.replace(/^\/api\/back-office\/?/, ""); // es. "main.js"
    rel = decodeURIComponent(rel).replace(/^\/+/, ""); // no leading slash

    // Hardening: niente traversal
    if (!rel || rel.includes("..")) return res.status(400).send("Bad Request");

    // Ordine di ricerca:
    // 1) CSS tenuti in /back-office (base.css, quotes-admin.css)
    // 2) tutto l'ESM in /assets/esm
    const candidates = [
      path.join(ROOT, "back-office", rel),
      path.join(ROOT, "assets", "esm", rel),
    ];

    let filePath = null;
    for (const p of candidates) {
      try {
        const st = await fs.stat(p);
        if (st.isFile()) { filePath = p; break; }
      } catch {}
    }

    if (!filePath) return res.status(404).send("Not Found");

    const buf = await fs.readFile(filePath);
    res.setHeader("Content-Type", contentType(filePath));
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).end(buf);
  } catch (e) {
    console.error("back-office static error", e);
    return res.status(500).send("Internal Error");
  }
}
