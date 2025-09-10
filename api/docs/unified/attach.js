export const config = { runtime: "nodejs18.x" };

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const PAT = process.env.AIRTABLE_PAT;
const TB = process.env.TB_SPEDIZIONI || "Spedizioni";
const FIELD = process.env.DOCS_FIELD_UNIFIED || "Doc_Unified_URL";
const SECRET = process.env.ATTACH_SECRET;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

export default async function handler(req, res) {
  try {
    const method = req.method;
    if (!["GET","POST"].includes(method)) {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).send("Method Not Allowed");
    }

    const shipmentId = (method === "GET" ? req.query.shipmentId : req.body?.shipmentId);
    const type = (method === "GET" ? req.query.type : req.body?.type) || "proforma";
    const token = (method === "GET" ? req.query.token : req.body?.token);

    if (!token || token !== SECRET) return res.status(401).json({ ok:false, error:"Unauthorized" });
    if (!shipmentId) return res.status(400).json({ ok:false, error:"Missing shipmentId" });

    const renderUrl = `${PUBLIC_BASE_URL}/api/docs/unified/render?shipmentId=${encodeURIComponent(shipmentId)}&type=${encodeURIComponent(type)}&token=${encodeURIComponent(SECRET)}`;
    const filename = `${type.toUpperCase()}-${shipmentId}.pdf`;

    // PATCH singolo record su Airtable con allegato via URL (Airtable scarica e salva)
    const patch = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TB)}/${shipmentId}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { [FIELD]: [{ url: renderUrl, filename }] }, "typecast": true })
    });

    if (!patch.ok) {
      const t = await patch.text();
      return res.status(502).json({ ok:false, error:"Airtable error", detail:t });
    }

    return res.status(200).json({ ok:true, url: renderUrl, field: FIELD, type });
  } catch (e) {
    console.error("unified/attach error", e);
    return res.status(500).json({ ok:false, error:"Internal Server Error" });
  }
}
