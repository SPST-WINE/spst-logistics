// pages/api/quotes/[slug].js

// ===== Airtable env =====
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI; // tabella Preventivi
const TB_OPT   = process.env.TB_OPZIONI;    // tabella OpzioniPreventivo
const TB_COLLI = process.env.TB_COLLI;      // tabella Colli (opzionale ma consigliata)

// ===== helpers =====
const isObj   = v => v && typeof v === "object";
const toNum   = v => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const notNil  = v => v !== undefined && v !== null && v !== "";
const pick = (obj, ...keys) => { for (const k of keys) { if (isObj(obj) && notNil(obj[k])) return obj[k]; } };
const safeStr = v => (v == null ? "" : String(v));

async function atList(table, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}${qs ? `?${qs}` : ""}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json?.error?.message || "Airtable error");
    err.status = resp.status;
    err.payload = json;
    err.table = table;
    throw err;
  }
  return json;
}

async function atFindOneBySlug(slug) {
  // {Slug_Pubblico} = slug
  const formula = `LOWER({Slug_Pubblico}) = '${String(slug || "").toLowerCase().replace(/'/g, "\\'")}'`;
  const data = await atList(TB_QUOTE, { filterByFormula: formula, maxRecords: 1, pageSize: 1 });
  return data.records?.[0];
}

function computeTotals(pkgs) {
  const pieces   = pkgs.reduce((s, p) => s + (toNum(p.qty) || 0), 0);
  const weightKg = pkgs.reduce((s, p) => s + (toNum(p.kg ?? p.weight) || 0) * (toNum(p.qty) || 0 || 1), 0);
  return { pieces, weightKg, weightFmt: `${weightKg.toFixed(2)} kg` };
}

// ===== API handler =====
export default async function handler(req, res) {
  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error("Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI");
    }

    const slug = safeStr(req.query.slug);
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

    // 1) Preventivo
    const rec = await atFindOneBySlug(slug);
    if (!rec) return res.status(404).json({ ok: false, error: "Quote not found" });
    const f = rec.fields || {};

    // Campi intestazione
    const quote = {
      id           : rec.id,
      slug         : slug,
      customerEmail: pick(f, "Email_Cliente", "Cliente_Email", "Email"),
      currency     : pick(f, "Valuta", "Currency") || "EUR",
      validUntil   : pick(f, "Valido_Fino_Al", "Valid_Until", "Scadenza") || null,
      notes        : pick(f, "Note_Globali", "Note", "Note_Globali_Cliente") || "",
      shipmentNotes: pick(f, "Note_Spedizione", "Note_Generiche_Spedizione", "Note_Sped") || "",
      sender: {
        name   : pick(f, "Mittente_Nome", "Sender_Name"),
        country: pick(f, "Mittente_Paese", "Sender_Country"),
        city   : pick(f, "Mittente_Citta", "Sender_City"),
        zip    : pick(f, "Mittente_CAP", "Sender_Zip"),
        address: pick(f, "Mittente_Indirizzo", "Sender_Address"),
        phone  : pick(f, "Mittente_Telefono", "Sender_Phone"),
        // preferisci un campo dedicato se c'è, altrimenti P.IVA generico
        tax    : pick(f, "Mittente_Tax", "P_IVA", "P. IVA", "IVA", "EORI"),
      },
      recipient: {
        name   : pick(f, "Destinatario_Nome", "Recipient_Name"),
        country: pick(f, "Destinatario_Paese", "Recipient_Country"),
        city   : pick(f, "Destinatario_Citta", "Recipient_City"),
        zip    : pick(f, "Destinatario_CAP", "Recipient_Zip"),
        address: pick(f, "Destinatario_Indirizzo", "Recipient_Address"),
        phone  : pick(f, "Destinatario_Telefono", "Recipient_Phone"),
        // Tax ID/EORI/EIN
        tax    : pick(f, "Destinatario_Tax", "Tax_ID", "EORI", "EIN"),
      },
    };

    // 2) Opzioni collegate
    const optAll = await atList(TB_OPT, { pageSize: 100 });
    const LINK_OPT_KEYS = ["Preventivo", "Preventivi", "Preventivo_Link", "Preventivo (link)", "PreventivoId", "Preventivo_Id"];

    const optRecs = (optAll.records || []).filter(r => {
      const fx = r.fields || {};
      return LINK_OPT_KEYS.some(k => {
        const v = fx[k];
        if (Array.isArray(v)) return v.includes(rec.id);
        if (typeof v === "string") return v === rec.id;
        return false;
      });
    });

    const options = optRecs
      .map(r => {
        const x = r.fields || {};
        return {
          index       : toNum(pick(x, "Indice", "Index")),
          carrier     : pick(x, "Corriere", "Carrier"),
          service     : pick(x, "Servizio", "Service"),
          transit     : pick(x, "Tempo_Resa", "Transit_Time", "Tempo di resa previsto"),
          incoterm    : pick(x, "Incoterm"),
          payer       : pick(x, "Oneri_A_Carico", "Payer"),
          price       : toNum(pick(x, "Prezzo", "Price")),
          currency    : pick(x, "Valuta", "Currency") || quote.currency || "EUR",
          notes       : pick(x, "Note_Operative", "Note"),
          recommended : !!pick(x, "Consigliata", "Recommended"),
        };
      })
      // nascondi opzioni senza dati essenziali
      .filter(o => o.carrier || o.service || o.price);

    // 3) Colli: JSON sul preventivo oppure records collegati in TB_COLLI
    let packages = [];
    const colliJson = pick(f, "Colli_JSON", "Packages_JSON");
    if (colliJson) {
      try {
        const arr = JSON.parse(String(colliJson));
        if (Array.isArray(arr)) {
          packages = arr.map(p => ({
            qty: toNum(p.qty) || 1,
            l  : toNum(p.l   ?? p.length) || 0,
            w  : toNum(p.w   ?? p.width ) || 0,
            h  : toNum(p.h   ?? p.height) || 0,
            kg : toNum(p.kg  ?? p.weight) || 0,
          }));
        }
      } catch { /* ignore */ }
    }

    if (!packages.length && TB_COLLI) {
      const pkgAll = await atList(TB_COLLI, { pageSize: 100 });

      const LINK_PKG_KEYS = ["Preventivo", "Preventivi", "Preventivo (link)", "Preventivo_Link", "PreventivoId", "Preventivo_Id"];
      const pkgRecs = (pkgAll.records || []).filter(r => {
        const fx = r.fields || {};
        return LINK_PKG_KEYS.some(k => {
          const v = fx[k];
          if (Array.isArray(v)) return v.includes(rec.id);
          if (typeof v === "string") return v === rec.id;
          return false;
        });
      });

      packages = pkgRecs.map(r => {
        const x = r.fields || {};
        return {
          qty: toNum(pick(x, "Quantita", "Quantità", "Qty", "Qta")) || 1,
          l  : toNum(pick(x, "L_cm", "L", "Lato 1", "Lunghezza")) || 0,
          w  : toNum(pick(x, "W_cm", "W", "Lato 2", "Larghezza")) || 0,
          h  : toNum(pick(x, "H_cm", "H", "Lato 3", "Altezza"))   || 0,
          kg : toNum(pick(x, "Peso", "Peso (kg)", "Peso_Kg", "Kg", "Weight")) || 0,
        };
      });
    }

    // 4) Totali
    const totals =
      (isObj(f) && (toNum(f["Tot_Colli"]) || toNum(f["Tot_Peso_Reale_Kg"])))
        ? {
            pieces   : toNum(f["Tot_Colli"]) || computeTotals(packages).pieces,
            weightKg : toNum(f["Tot_Peso_Reale_Kg"]) || computeTotals(packages).weightKg,
            weightFmt: `${(toNum(f["Tot_Peso_Reale_Kg"]) || computeTotals(packages).weightKg).toFixed(2)} kg`,
          }
        : computeTotals(packages);

    return res.status(200).json({
      ok: true,
      quote,
      options,
      packages,
      totals,
      counts: { options: options.length, packages: packages.length },
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ ok: false, error: { name: err.name, message: err.message, table: err.table, payload: err.payload } });
  }
}
