// api/shipments/[id]/index.js
import { withCors } from "../../_lib/cors.js";
import { getShipmentBO } from "../../_lib/shipments.js";

export default withCors(async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ ok: false, error: "Missing id" });
    return;
  }

  try {
    const data = await getShipmentBO(id);
    res.status(200).json({ ok: true, record: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
