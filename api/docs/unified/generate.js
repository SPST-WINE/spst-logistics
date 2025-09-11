// api/docs/unified/generate.js
export const config = { runtime: "nodejs", maxDuration: 30, memory: 256 };

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const PAT = process.env.AIRTABLE_PAT;
const TB = process.env.TB_SPEDIZIONI || "SpedizioniWebApp";
const FIELD = process.env.DOCS_FIELD_UNIFIED || "Allegato Fattura";
const SECRET = process.env.ATTACH_SECRET;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL; // opzionale fallback

function baseUrlFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return PUBLIC_BASE_URL || `${proto}://${host}`;
}

export default async function handler(req, res) {
  const method = req.method;
  if (method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { shipmentId, type = "proforma" } = req.body || {};
    if (!shipmentId) return res.status(400).json({ ok:false, error:"Missing shipmentId" });

    const base = baseUrlFromReq(req);
    const url = `${base}/api/docs/unified/render?shipmentId=${encodeURIComponent(shipmentId)}&type=${encodeURIComponent(type)}&token=${encodeURIComponent(SECRET)}`;
    const filename = `${type.toUpperCase()}-${shipmentId}.pdf`;

    // PATCH allegato su Airtable (allegato via URL remoto)
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TB)}/${shipmentId}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { [FIELD]: [{ url, filename }] }, typecast: true })
    });

    if (!r.ok) {
      const t = await r.text().catch(()=> "");
      return res.status(502).json({ ok:false, error:"Airtable error", detail:t });
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ ok:true, url, field: FIELD, type });
  } catch (e) {
    console.error("unified/generate error", e);
    return res.status(500).json({ ok:false, error:"Internal Server Error" });
  }
}
