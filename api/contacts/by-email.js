import { withCORS } from "../../_lib/cors.js";
import { findFirstByEmail } from "../../_lib/airtable.js";

// Imposta qui la tua tabella anagrafiche e il nome esatto del campo email
const TB_CONTATTI = process.env.TB_CONTATTI || "Contatti";
const EMAIL_FIELD = process.env.TB_CONTATTI_EMAIL_FIELD || "Email";

export default withCORS(async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok:false, error:"Method not allowed" }); return;
    }
    const email = String(req.query.email || "").trim();
    if (!email) { res.status(400).json({ ok:false, error:"Missing email" }); return; }

    const rec = await findFirstByEmail(TB_CONTATTI, EMAIL_FIELD, email);
    if (!rec) { res.status(404).json({ ok:false, data:null }); return; }

    const f = rec.fields || {};
    // Adatta i nomi per tornare i campi che la UI si aspetta
    res.json({
      ok:true,
      data:{
        name:    f["Ragione sociale"] || f["Nome"] || "",
        country: f["Paese"] || "",
        city:    f["Città"] || "",
        zip:     f["CAP"] || "",
        address: f["Indirizzo"] || "",
        phone:   f["Telefono"] || "",
        tax:     f["P. IVA / EORI"] || ""
      }
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});
