// api/shipments/[id]/status.js
import { withCors } from "../../_lib/cors.js";
import { updateShipmentStatus } from "../../_lib/shipments.js";

export default withCors(async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ ok: false, error: "Missing id" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { stato } = body;
    if (!stato || typeof stato !== "string") {
      res.status(400).json({ ok: false, error: "Missing 'stato' string" });
      return;
    }

    const updated = await updateShipmentStatus(id, stato);
    res.status(200).json({ ok: true, record: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
