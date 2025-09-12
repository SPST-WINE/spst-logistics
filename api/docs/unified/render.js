// api/docs/unified/render.js — Vercel Function (Pages Router)
const crypto = require('crypto');

const SECRET = process.env.DOCS_SIGNING_SECRET || process.env.ATTACH_SECRET || '';

function hmacHex(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}
function safeEq(a, b) {
  try {
    const A = Buffer.from(String(a), 'utf8');
    const B = Buffer.from(String(b), 'utf8');
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}
function bad(res, code, error, details) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify({ ok: false, error, details }));
}

function htmlTemplate({ docTitle, docTag, shipId, courier, generatedAt }) {
  // Template elegante (versione “preview HTML”) — stampa con Cmd/Ctrl+P
  return String.raw/*html*/`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${docTitle} — Anteprima</title>
  <style>
    :root{
      --brand:#111827; --accent:#0ea5e9; --text:#0b0f13; --muted:#6b7280;
      --border:#e5e7eb; --border-strong:#d1d5db; --bg:#ffffff; --zebra:#fafafa; --chip:#f3f4f6;
    }
    *{box-sizing:border-box}
    html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;}
    .page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative;}

    .watermark{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none}
    .watermark span{opacity:0.05; font-size:120px; letter-spacing:0.22em; transform:rotate(-24deg); font-weight:800; color:#0f172a}

    header{display:grid; grid-template-columns:1fr auto; align-items:start; gap:16px}
    .brand{max-width:70%}
    .tag{display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#374151; background:var(--chip); border:1px solid var(--border); padding:2px 6px; border-radius:6px; margin-bottom:6px}
    .logo{display:flex; align-items:center; gap:10px}
    .logo .word{font-size:26px; font-weight:800; letter-spacing:.01em; color:var(--brand)}
    .brand .meta{margin-top:6px; font-size:12px; color:var(--muted)}

    .doc-meta{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:10px; padding:10px; min-width:260px}
    .doc-meta .title{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); font-weight:800}
    .doc-meta .kv{margin-top:6px}
    .kv div{margin:2px 0}

    hr.sep{border:none;border-top:1px solid var(--border); margin:16px 0 18px}

    .placeholder{margin-top:12px; border:1px solid var(--border-strong); background:#eef5ff; color:#22324d; padding:12px; border-radius:12px}
    .placeholder h4{margin:0 0 8px; font-size:12px}

    @media print{
      body{background:#fff}
      .page{box-shadow:none; padding:10mm}
      .watermark span{opacity:0.08}
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="watermark"><span>${docTag.toUpperCase()}</span></div>

    <header>
      <div class="brand">
        <div class="tag">SPST Logistics</div>
        <div class="logo"><div class="word">SPST S.r.l.</div></div>
        <div class="meta">info@spst.it · +39 320 144 1789 · www.spst.it</div>
      </div>
      <div class="doc-meta">
        <div class="title">${docTitle}</div>
        <div class="kv">
          <div><strong>ID Spedizione:</strong> ${shipId || '—'}</div>
          <div><strong>Corriere:</strong> ${courier || '—'}</div>
          <div><strong>Generato:</strong> ${generatedAt}</div>
        </div>
      </div>
    </header>

    <hr class="sep" />

    <section class="placeholder">
      <h4>Contenuti documento (placeholder)</h4>
      <div>Questa anteprima è in HTML “pulito” (senza Chromium). Stampa e salva in PDF con <em>File → Stampa</em> (o ⌘/Ctrl+P).</div>
      <div>Quando vuoi, sostituiremo questo blocco con il layout definitivo.</div>
    </section>
  </div>

  <script>
    (function(){
      const params = new URLSearchParams(location.search);
      if (params.get('print') === '1') {
        // attendo il paint
        setTimeout(() => { window.print(); }, 120);
      }
    })();
  </script>
</body>
</html>`;
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const { sid, type, exp, sig } = q;

    if (!sid || !exp || !sig || !SECRET) {
      return bad(res, 400, 'Missing params');
    }

    // Verifica firma tollerante (type normalizzato / grezzo / legacy senza type)
    const typeRaw  = (type ?? '');
    const typeNorm = (typeRaw || 'proforma').toLowerCase();
    const bases = [
      `${sid}.${typeNorm}.${exp}`,   // preferita
      `${sid}.${typeRaw}.${exp}`,    // come arriva
    ];
    if (!typeRaw) bases.push(`${sid}..${exp}`); // vecchi link

    let okSig = false;
    for (const b of bases) {
      if (safeEq(sig, hmacHex(b))) { okSig = true; break; }
    }
    if (!okSig) {
      console.warn('[render] sig mismatch', { sid, typeRaw, typeNorm, exp, tried: bases });
      return bad(res, 401, 'Unauthorized', 'Invalid signature');
    }

    // Scadenza
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > Number(exp)) {
      return bad(res, 401, 'Link expired');
    }

    // Modalità HTML (anteprima/print)
    if ((q.format || '').toLowerCase() === 'html') {
      const docTitle =
        typeNorm === 'fattura' || typeNorm === 'invoice' ? 'Fattura commerciale' :
        typeNorm === 'dle' ? 'Dichiarazione libera esportazione' :
        'Proforma Invoice';
      const docTag = typeNorm === 'dle' ? 'DLE' : (typeNorm === 'fattura' || typeNorm === 'invoice') ? 'INVOICE' : 'PROFORMA';
      const shipId = q.ship || ''; // opzionale, non firmato
      const courier = q.courier || '';
      const generatedAt = new Date().toLocaleString('it-IT', { hour12:false });

      const html = htmlTemplate({ docTitle, docTag, shipId, courier, generatedAt });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(html);
    }

    // Se qualcuno chiama senza format=html
    return bad(res, 400, 'Unsupported', 'Use ?format=html (optionally &print=1)');
  } catch (err) {
    console.error('[render] 500', err);
    return bad(res, 500, 'Render error', err && err.message ? err.message : String(err));
  }
}
