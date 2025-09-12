// api/docs/unified/render.js  (ESM + Node 20)
export const config = { runtime: 'nodejs' };

import crypto from 'node:crypto';

const SECRET = process.env.DOCS_SIGNING_SECRET || process.env.ATTACH_SECRET || '';
const DEBUG  = (process.env.DEBUG_DOCS || '0') === '1';

const hmacHex = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const safeEq = (a, b) => {
  try {
    const A = Buffer.from(String(a), 'utf8');
    const B = Buffer.from(String(b), 'utf8');
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  } catch { return false; }
};
const bad = (res, code, error, details) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify({ ok: false, error, details }));
};

function htmlTemplate({ docTitle, docTag, shipId, courier, generatedAt }) {
  return `<!doctype html><html lang="it"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${docTitle} — Anteprima</title>
<style>
:root{--brand:#111827;--accent:#0ea5e9;--text:#0b0f13;--muted:#6b7280;--border:#e5e7eb;--border-strong:#d1d5db;--bg:#fff;--chip:#f3f4f6}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.page{width:210mm;min-height:297mm;margin:0 auto;padding:18mm 16mm;position:relative}
.watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.watermark span{opacity:.05;font-size:120px;letter-spacing:.22em;transform:rotate(-24deg);font-weight:800;color:#0f172a}
header{display:grid;grid-template-columns:1fr auto;align-items:start;gap:16px}
.brand{max-width:70%}
.tag{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#374151;background:var(--chip);border:1px solid var(--border);padding:2px 6px;border-radius:6px;margin-bottom:6px}
.logo{display:flex;align-items:center;gap:10px}
.logo .word{font-size:26px;font-weight:800;letter-spacing:.01em;color:var(--brand)}
.brand .meta{margin-top:6px;font-size:12px;color:var(--muted)}
.doc-meta{text-align:right;font-size:12px;border:1px solid var(--border);border-radius:10px;padding:10px;min-width:260px}
.doc-meta .title{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:800}
.kv div{margin:2px 0}
hr.sep{border:none;border-top:1px solid var(--border);margin:16px 0 18px}
.placeholder{margin-top:12px;border:1px solid var(--border-strong);background:#eef5ff;color:#22324d;padding:12px;border-radius:12px}
.placeholder h4{margin:0 0 8px;font-size:12px}
@media print{.page{box-shadow:none;padding:10mm}.watermark span{opacity:.08}}
</style>
</head><body>
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
  <hr class="sep"/>
  <section class="placeholder">
    <h4>Contenuti documento (placeholder)</h4>
    <div>Questa anteprima è HTML “pulito”. Stampa/Salva PDF con ⌘/Ctrl+P.</div>
    <div>Quando vuoi, sostituiamo questo blocco con il layout definitivo.</div>
  </section>
</div>
<script>
(function(){var p=new URLSearchParams(location.search); if(p.get('print')==='1'){ setTimeout(()=>window.print(),120); }})();
</script>
</body></html>`;
}

export default async function handler(req, res) {
  try{
    const q = req.query || {};
    const { sid, type, exp, sig } = q;
    if (!sid || !exp || !sig || !SECRET) return bad(res, 400, 'Missing params');

    const tRaw  = type ?? '';
    const tNorm = (tRaw || 'proforma').toLowerCase();
    const bases = [`${sid}.${tNorm}.${exp}`, `${sid}.${tRaw}.${exp}`]; // compat
    if (!tRaw) bases.push(`${sid}..${exp}`);

    let signed = false, matchedBase = '';
    for (const b of bases) { const d = hmacHex(b); if (safeEq(sig, d)) { signed = true; matchedBase = b; break; } }
    if (!signed) {
      if (DEBUG) console.error('[render] bad sig', { got: String(sig).slice(0,10)+'…', sid, type:tRaw, exp, tried:bases });
      return bad(res, 401, 'Unauthorized', 'Invalid signature');
    }

    const now = Math.floor(Date.now()/1000);
    if (now > Number(exp)) return bad(res, 401, 'Link expired');

    if ((q.format || '').toLowerCase() === 'html') {
      const docTitle = tNorm==='fattura'||tNorm==='invoice' ? 'Fattura commerciale' : (tNorm==='dle' ? 'Dichiarazione libera esportazione' : 'Proforma Invoice');
      const tag = tNorm==='dle' ? 'DLE' : (tNorm==='fattura'||tNorm==='invoice') ? 'INVOICE' : 'PROFORMA';
      const html = htmlTemplate({
        docTitle,
        docTag: tag,
        shipId: q.ship || '',
        courier: q.courier || '',
        generatedAt: new Date().toLocaleString('it-IT', { hour12:false })
      });
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Cache-Control','no-store');
      return res.status(200).send(html);
    }

    return bad(res, 400, 'Unsupported', 'Use ?format=html (optionally &print=1)');
  }catch(e){
    console.error('[render] 500', e);
    return bad(res, 500, 'Render error', e?.message || String(e));
  }
}
