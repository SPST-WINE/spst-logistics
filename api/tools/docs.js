// api/tools/docs.js
export const config = { runtime: 'nodejs' };

const HTML = `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>SPST • Utility Documenti</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  body{font-family:Inter,system-ui,Arial;margin:24px;background:#0b1220;color:#e7ecf5}
  .card{max-width:720px;margin:0 auto;background:#111a2b;border:1px solid #1f2a44;border-radius:14px;padding:18px}
  h1{font-size:18px;margin:0 0 12px}
  label{font-size:13px;color:#a9b3c7}
  input,select{width:100%;height:40px;border-radius:10px;border:1px solid #2a385a;background:#0f1627;color:#e7ecf5;padding:0 12px}
  .row{display:grid;grid-template-columns:1fr 180px;gap:10px}
  .small{color:#93a0bb;font-size:12px;margin-top:8px}
  button{height:40px;border-radius:10px;border:1px solid #f59e0b;background:#f59e0b;color:#111;font-weight:700;cursor:pointer}
  .out{margin-top:14px;white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;background:#0a0f1c;border:1px solid #1f2a44;border-radius:10px;padding:10px}
</style>
</head><body>
  <div class="card">
    <h1>Utility Documenti (Proforma / PL / DLE / Fattura)</h1>
    <div style="display:grid;gap:12px">
      <div>
        <label>ID Spedizione (record Airtable)</label>
        <input id="sid" placeholder="recXXXXXXXXXXXX" />
      </div>
      <div class="row">
        <div>
          <label>Tipo documento</label>
          <select id="dtype">
            <option value="proforma">Proforma</option>
            <option value="pl">Packing List</option>
            <option value="dle">Dich. Esportazione (DLE)</option>
            <option value="invoice">Fattura</option>
          </select>
        </div>
        <div>
          <label>Admin key (opz.)</label>
          <input id="akey" placeholder="(se impostata in Vercel)" />
        </div>
      </div>
      <button id="go">Genera e allega</button>
      <div id="out" class="out"></div>
      <div class="small">Nota: l’URL firmato scade in ~10 minuti; Airtable scarica e salva il PDF nel proprio CDN.</div>
    </div>
  </div>

<script>
const $ = s => document.querySelector(s);
$('#go').addEventListener('click', async () => {
  const sid = $('#sid').value.trim();
  const type = $('#dtype').value;
  const akey = $('#akey').value.trim();
  $('#out').textContent = 'Invio richiesta…';
  try{
    const r = await fetch('/api/docs/unified/generate', {
      method:'POST',
      headers: Object.assign({'Content-Type':'application/json'}, akey ? {'x-admin-key': akey} : {}),
      body: JSON.stringify({ shipmentId: sid, type })
    });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
    $('#out').textContent = [
      'OK ✓ Documento:', type,
      '\\nCampo:', j.field,
      '\\nURL firmato:', j.url,
      '\\nApri il record su Airtable: l\\'allegato comparirà a breve.'
    ].join(' ');
  }catch(e){
    $('#out').textContent = 'Errore: ' + (e.message || e);
  }
});
</script>
</body></html>`;

export default async function handler(req, res){
  console.log('[tools/docs] hit', {
    ua: req.headers['user-agent'],
    host: req.headers.host,
    url: req.url,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  return res.status(200).send(HTML);
}
