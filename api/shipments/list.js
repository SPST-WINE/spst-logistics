// api/shipments/list.js
import { withCors } from "../_lib/cors.js";
import { listShipmentsBO } from "../_lib/shipments.js";

export default withCors(async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  const {
    q,
    email,
    from,
    to,
    pageSize,
    offset,
  } = req.query;

  // stato può essere ?stato=A&stato=B oppure ?stato=A,B
  let stati = req.query.stato;
  if (typeof stati === "string") {
    stati = stati.includes(",") ? stati.split(",").map(s => s.trim()).filter(Boolean) : [stati];
  } else if (!Array.isArray(stati)) {
    stati = []; // nessun filtro di stato
  }

  try {
    const { rows, offset: nextOffset } = await listShipmentsBO({
      q,
      email,
      from,
      to,
      stati,
      pageSize: pageSize ? Number(pageSize) : 50,
      offset,
    });

    res.status(200).json({ ok: true, rows, offset: nextOffset || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
