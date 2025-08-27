// api/quotes/[slug].js

/* ===================== Config & helpers ===================== */
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;     // "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;        // "OpzioniPreventivo"
const TB_COLLI = process.env.TB_COLLI;          // "Colli" (linkata a Preventivi)

/** fetch wrapper Airtable */
async function atFetch(path) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${path}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json?.error?.message || `Airtable HTTP ${resp.status}`);
    err.status = resp.status; err.payload = json;
    throw err;
  }
  return json;
}

const toNum = v => {
  const n = Number(v); return Number.isFinite(n) ? n : undefined;
};
const z = s => (s == null ? "" : String(s)); // safe string

/** HTML escape */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => (
  { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
));

/* ===================== Build public HTML ===================== */
function buildPublicHtml(model) {
  const { customerEmail, currency, validUntil, notes, shipmentNotes,
          sender={}, recipient={}, packages=[], options=[] } = model;

  // consigliata
  const bestIdx = (() => {
    const chosen = options.find(o => o.recommended);
    if (chosen) return chosen.index;
    const priced = options.filter(o => typeof o.price === "number")
                          .sort((a,b)=>a.price-b.price);
    return priced[0]?.index;
  })();

  // Colli: totali + righe
  const pieces = packages.reduce((s,p)=> s + (Number(p.qty)||0), 0);
  const weight = packages.reduce((s,p)=> s + (Number(p.kg ?? p.weight) || 0) * (Number(p.qty)||1), 0);

  const pkgRows = packages.map(p => {
    const qty = Number(p.qty) || 1;
    const l = Number(p.l ?? p.length ?? 0);
    const w = Number(p.w ?? p.width  ?? 0);
    const h = Number(p.h ?? p.height ?? 0);
    const kg = Number(p.kg ?? p.weight ?? 0);
    const dims = [l,w,h].map(n => (Number.isFinite(n)?n:0).toFixed(1)).join(' × ');
    return (
      '<tr>'
        + '<td style="padding:6px 8px">'+ qty +'</td>'
        + '<td style="padding:6px 8px">'+ dims +'</td>'
        + '<td style="padding:6px 8px">'+ (Number.isFinite(kg)?kg:0).toFixed(2) +'</td>'
      + '</tr>'
    );
  }).join('');

  const optBlocks = options.map(o => (
    '<div class="opt '+(o.index===bestIdx?'is-best':'')+'">'
      + '<div class="opt-head"><div class="badge">OPZIONE '+esc(String(o.index||''))+'</div>'
      + (o.index===bestIdx ? '<span class="pill">Consigliata</span>' : '')
      + '</div>'
      + '<div class="grid">'
        + '<div><div class="k">Corriere</div><div class="v">'+esc(o.carrier||'—')+'</div></div>'
        + '<div><div class="k">Servizio</div><div class="v">'+esc(o.service||'—')+'</div></div>'
        + '<div><div class="k">Tempo di resa previsto</div><div class="v">'+esc(o.transit||'—')+'</div></div>'
        + '<div><div class="k">Incoterm</div><div class="v">'+esc(o.incoterm||'—')+'</div></div>'
        + '<div><div class="k">Oneri a carico di</div><div class="v">'+esc(o.payer||'—')+'</div></div>'
        + '<div><div class="k">Prezzo</div><div class="v">'+(
              typeof o.price==='number'
                ? new Intl.NumberFormat('it-IT',{style:'currency',currency:o.currency||currency||'EUR'}).format(o.price)
                : '—'
            )+'</div></div>'
      + '</div>'
      + (o.notes ? '<div class="notes"><strong>Note operative:</strong> '+esc(o.notes)+'</div>' : '')
    + '</div>'
  )).join('');

  const parts = [];
  parts.push(
    '<!doctype html><html lang="it"><head>',
    '<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<title>Preventivo SPST</title>',
    '<style>',
      ':root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}',
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}',
      '.wrap{max-width:960px;margin:24px auto;padding:0 16px}',
      '.header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}',
      '.brand{display:flex;align-items:center;gap:10px}.logo{width:26px;height:26px}',
      'h1{margin:0;font-size:22px}',
      '.card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0}',
      '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.k{font-size:12px;color:var(--muted)}.v{font-weight:600}',
      '.badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--brand);color:var(--brand);background:rgba(247,145,30,.12);font-size:10px}',
      '.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:rgba(110,168,255,.15);border:1px solid rgba(110,168,255,.4);font-size:11px}',
      '.opt{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin:10px 0;background:#0d152a}',
      '.opt.is-best{box-shadow:inset 0 0 0 1px rgba(110,168,255,.45), 0 6px 16px rgba(0,0,0,.25)}',
      '.opt-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}',
      '.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
      '.notes{margin-top:8px;color:var(--muted)}.small{font-size:12px;color:var(--muted)}',
      'table{border-collapse:collapse;width:100%}th,td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left}',
      '@media (max-width:900px){.grid{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}}',
    '</style></head><body><div class="wrap">'
  );

  parts.push(
    '<div class="header"><div class="brand">',
      '<img class="logo" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST logo" />',
      '<h1>Preventivo SPST</h1>',
    '</div>',
    '<div class="small">Valido fino al <strong>', esc(validUntil || '—') ,'</strong></div>',
    '</div>'
  );

  // Dati cliente
  parts.push(
    '<div class="card"><div class="grid2">',
      '<div><div class="k">Cliente</div><div class="v">', esc(customerEmail || '—') ,'</div></div>',
      '<div><div class="k">Valuta</div><div class="v">',   esc(currency || 'EUR') ,'</div></div>',
    '</div>',
    (notes ? '<div style="margin-top:10px"><div class="k">Note</div><div class="v">'+esc(notes)+'</div></div>' : ''),
    '</div>'
  );

  // Mittente / Destinatario (con Tax)
  const senderLine = [sender.address, sender.zip, sender.city, sender.country].filter(Boolean).join(', ');
  const rcptLine   = [recipient.address, recipient.zip, recipient.city, recipient.country].filter(Boolean).join(', ');

  parts.push(
    '<div class="card"><div class="grid2">',
      '<div><div class="k">Mittente</div><div class="v">', esc(sender.name || '—') ,'</div>',
        '<div class="small">', esc(senderLine) ,'</div>',
        (sender.tax ? '<div class="small">P. IVA / EORI: '+esc(sender.tax)+'</div>' : ''),
      '</div>',
      '<div><div class="k">Destinatario</div><div class="v">', esc(recipient.name || '—') ,'</div>',
        '<div class="small">', esc(rcptLine) ,'</div>',
        (recipient.tax ? '<div class="small">Tax ID / EORI: '+esc(recipient.tax)+'</div>' : ''),
      '</div>',
    '</div></div>'
  );

  // Note generiche spedizione
  if (shipmentNotes) {
    parts.push(
      '<div class="card">',
        '<div class="k" style="margin-bottom:6px">Note generiche sulla spedizione</div>',
        '<div class="v">', esc(shipmentNotes) ,'</div>',
      '</div>'
    );
  }

  // Colli
  parts.push(
    '<div class="card"><div class="k" style="margin-bottom:6px">Colli</div>',
    '<div class="small" style="margin-bottom:8px">Totale colli: <strong>', String(pieces) ,'</strong> · Peso reale totale: <strong>', weight.toFixed(2) ,' kg</strong></div>',
    packages.length
      ? '<div style="overflow:auto"><table><thead><tr>'
          + '<th class="k">Quantità</th>'
          + '<th class="k">L × W × H (cm)</th>'
          + '<th class="k">Peso (kg)</th>'
        + '</tr></thead><tbody>'+pkgRows+'</tbody></table></div>'
      : '',
    '</div>'
  );

  // Opzioni
  parts.push(
    '<div class="card"><div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>',
    (optBlocks || '<div class="small">Nessuna opzione.</div>'),
    '</div>'
  );

  parts.push(
    '<div class="small" style="margin-top:8px">Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente. ',
    'Per maggiori informazioni consulta i <a style="color:#9ec1ff" href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.',
    '</div>'
  );

  parts.push('</div></body></html>');
  return parts.join('');
}

/* ===================== Handler ===================== */
export default async function handler(req, res) {
  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT || !TB_COLLI) {
      throw new Error('Missing env vars (Airtable config or table ids).');
    }

    const slug = decodeURIComponent((req.query?.slug || '') + '');
    if (!slug) return res.status(400).json({ ok:false, error:'Missing slug' });

    // 1) Preventivo per slug
    const filt = encodeURIComponent(`LOWER({Slug_Pubblico})='${slug.toLowerCase()}'`);
    const qResp = await atFetch(`${encodeURIComponent(TB_QUOTE)}?maxRecords=1&filterByFormula=${filt}`);
    const rec = qResp.records?.[0];
    if (!rec) return res.status(404).send('Not found');

    const f = rec.fields || {};
    const quoteId = rec.id;

    const model = {
      id          : quoteId,
      slug        : slug,
      customerEmail: f.Email_Cliente || '',
      currency    : f.Valuta || 'EUR',
      validUntil  : f.Valido_Fino_Al || '',
      notes       : f.Note_Globali || '',
      shipmentNotes: f.Note_Spedizione || f.Note_spedizione || f.Shipment_Notes || '',
      sender: {
        name   : f.Mittente_Nome || '',
        country: f.Mittente_Paese || '',
        city   : f.Mittente_Citta || '',
        zip    : f.Mittente_CAP || '',
        address: f.Mittente_Indirizzo || '',
        phone  : f.Mittente_Telefono || '',
        tax    : f.Mittente_Tax || ''
      },
      recipient: {
        name   : f.Destinatario_Nome || '',
        country: f.Destinatario_Paese || '',
        city   : f.Destinatario_Citta || '',
        zip    : f.Destinatario_CAP || '',
        address: f.Destinatario_Indirizzo || '',
        phone  : f.Destinatario_Telefono || '',
        tax    : f.Destinatario_Tax || ''
      },
      packages: [],
      options : []
    };

    // 2) Colli (linkati)
    const filtColli = encodeURIComponent(`FIND("${quoteId}", ARRAYJOIN({Preventivo}))`);
    const cResp = await atFetch(`${encodeURIComponent(TB_COLLI)}?filterByFormula=${filtColli}`);
    model.packages = (cResp.records || []).map(r => {
      const c = r.fields || {};
      return {
        qty : toNum(c.Quantita) || 1,
        l   : toNum(c.L_cm),
        w   : toNum(c.W_cm),
        h   : toNum(c.H_cm),
        kg  : toNum(c.Peso_Kg ?? c.Peso)
      };
    }).filter(p => (p.qty || 0) > 0);

    // 3) Opzioni (linkate)
    const filtOpt = encodeURIComponent(`FIND("${quoteId}", ARRAYJOIN({Preventivo}))`);
    const oResp = await atFetch(`${encodeURIComponent(TB_OPT)}?filterByFormula=${filtOpt}`);
    model.options = (oResp.records || []).map(r => {
      const o = r.fields || {};
      return {
        index : toNum(o.Indice),
        carrier: z(o.Corriere),
        service: z(o.Servizio),
        transit: z(o.Tempo_Resa),
        incoterm: z(o.Incoterm),
        payer : z(o.Oneri_A_Carico),
        price : toNum(o.Prezzo),
        currency: z(o.Valuta || model.currency),
        notes : z(o.Note_Operative),
        recommended: !!o.Consigliata
      };
    });

    // 4) Totali
    const totPieces = model.packages.reduce((s,p)=> s + (Number(p.qty)||0), 0);
    const totWeight = model.packages.reduce((s,p)=> s + (Number(p.kg)||0) * (Number(p.qty)||1), 0);

    const payload = {
      ok: true,
      quote: {
        id: model.id, slug: model.slug,
        customerEmail: model.customerEmail,
        currency: model.currency, validUntil: model.validUntil,
        notes: model.notes, shipmentNotes: model.shipmentNotes
      },
      sender: model.sender,
      recipient: model.recipient,
      packages: model.packages,
      options: model.options,
      totals: { pieces: totPieces, weightKg: totWeight, weightFmt: `${totWeight.toFixed(2)} kg` }
    };

    // === Content negotiation ===
    const wantsJson = (req.query?.format === 'json')
                   || (req.headers.accept || '').includes('application/json');

    if (wantsJson) {
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.status(200).send(JSON.stringify(payload));
    }

    // Default: HTML public page
    const html = buildPublicHtml({
      customerEmail: model.customerEmail,
      currency: model.currency,
      validUntil: model.validUntil,
      notes: model.notes,
      shipmentNotes: model.shipmentNotes,
      sender: model.sender,
      recipient: model.recipient,
      packages: model.packages,
      options: model.options
    });
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','public, max-age=60'); // 1 min
    return res.status(200).send(html);

  } catch (err) {
    const status = err.status || 500;
    console.error('[quote slug] error', { status, msg: err.message, payload: err.payload });
    if ((req.headers.accept || '').includes('text/html') && !((req.query||{}).format === 'json')) {
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.status(status).send('<!doctype html><meta charset="utf-8"><title>Errore</title><pre>'+esc(err.message)+'</pre>');
    }
    return res.status(status).json({ ok:false, error: { message: err.message, details: err.payload } });
  }
}
