// api/tools/docs.js — Vercel Function (Pages Router)
export default async function handler(req, res) {
  const now = new Date().toISOString();
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).send('Method Not Allowed');
    }

    console.log('[tools/docs] GET', now, {
      host: req.headers.host,
      referer: req.headers.referer,
      ua: req.headers['user-agent'],
    });

    const html = String.raw/*html*/`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Utility Documenti</title>
  <link rel="icon" href="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/6859a72cac2c0604fbd192e3_favicon.ico" />
  <style>
    :root{
      --bg:#0b1220; --card:#0f172a; --muted:#8ea0bd; --text:#e7ecf5;
      --accent:#ff9a1f; --accent2:#ffb54f; --line:rgba(255,255,255,.08);
      --shadow:0 10px 30px rgba(0,0,0,.35);
      --r:18px; --rsm:12px; --gap:14px; --w:760px;
    }
    *{box-sizing:border-box} html,body{height:100%}
    body{
      margin:0; color:var(--text);
      background:radial-gradient(1200px 600px at 20% -10%, #11213f 0%, rgba(17,33,63,0) 60%), var(--bg);
      font:16px/1.45 system-ui, Segoe UI, Inter, Roboto, sans-serif;
      display:flex; align-items:flex-start; justify-content:center; padding:32px 16px 60px;
    }
    .wrap{width:min(var(--w),100%)}
    .page-title{font-size:clamp(26px,3.2vw,34px);font-weight:800;letter-spacing:.2px;margin:6px 0 6px}
    .page-sub{color:var(--muted);margin:0 0 18px;max-width:70ch}
    .card{
      background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,.01)),var(--card);
      border:1px solid var(--line); border-radius:var(--r); box-shadow:var(--shadow); padding:18px; width:100%;
      overflow:hidden;
    }
    .row{display:grid;grid-template-columns:1fr;gap:var(--gap)}
    @media (min-width:760px){ .row.cols-2{grid-template-columns:1.2fr .8fr} }
    .field{display:flex;flex-direction:column;gap:8px}
    label{color:var(--muted);font-weight:600;letter-spacing:.2px}
    input,select{
      width:100%; border:1px solid var(--line); background:#0b1328; color:var(--text);
      border-radius:var(--rsm); padding:12px 14px; outline:none;
      transition:border-color .15s, box-shadow .15s;
    }
    input:focus,select:focus{border-color:rgba(255,154,31,.6);box-shadow:0 0 0 4px rgba(255,154,31,.15)}
    .actions{margin-top:8px;display:flex;gap:10px}
    button{
      border:0; cursor:pointer; width:100%; padding:14px 18px; border-radius:var(--rsm);
      color:#111; font-weight:800; letter-spacing:.3px;
      background:linear-gradient(180deg,var(--accent),var(--accent2));
      box-shadow:0 6px 18px rgba(255,154,31,.25), inset 0 1px 0 rgba(255,255,255,.3);
      transition:transform .05s, filter .15s, box-shadow .15s;
    }
    button:hover{filter:brightness(1.02)} button:active{transform:translateY(1px)}
    button[disabled]{opacity:.55;cursor:not-allowed;filter:grayscale(.2)}
    .note{margin-top:12px;font-size:14px;color:var(--muted);padding:10px 12px;border:1px dashed var(--line);border-radius:12px}
    .log{margin-top:12px;min-height:40px;border-radius:12px;background:#0b1328;border:1px solid var(--line);
         padding:10px 12px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;color:#cfe0ff;white-space:pre-wrap}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="page-title">Utility Documenti</div>
    <div class="page-sub">Utilizza questo tool per creare <strong>Fattura proforma</strong>, <strong>Fattura commerciale</strong> e <strong>Dichiarazione libera esportazione</strong>.</div>

    <div class="card">
      <div class="row cols-2">
        <div class="field">
          <label for="idsped">ID Spedizione</label>
          <input id="idsped" placeholder="es. SP-2025-09-04-2000" />
        </div>
        <div class="field">
          <label for="tipo">Tipo documento</label>
          <select id="tipo">
            <option value="proforma">Proforma</option>
            <option value="fattura">Fattura commerciale</option>
            <option value="dle">Dichiarazione libera esportazione</option>
          </select>
        </div>
      </div>

      <div class="actions"><button id="go">Genera e allega</button></div>
      <div class="note">Nota: l’URL firmato scade in ~10 minuti; l’allegato viene salvato su Airtable.</div>
      <div id="log" class="log"></div>
    </div>
  </div>

<script>
  (function(){
    var $ = function(s, r){ return (r||document).querySelector(s); };
    var inpId = $('#idsped');
    var selTp = $('#tipo');
    var btn   = $('#go');
    var log   = $('#log');

    function say(t, ok){
      log.textContent = t || '';
      log.style.borderColor = ok ? 'rgba(0,180,110,.35)' : 'rgba(255,120,120,.35)';
    }
    function pretty(obj) {
      try { return JSON.stringify(obj, null, 2); } catch(e) { return String(obj); }
    }
    function validate(){
      var v = (inpId.value || '').trim();
      btn.disabled = !v;
      return !!v;
    }
    inpId.addEventListener('input', validate);
    validate();

    btn.addEventListener('click', function(){
      if (!validate()) return;

      var idSped = inpId.value.trim();
      var type   = selTp.value;

      btn.disabled = true;
      say('Generazione in corso…');

      var headers = { 'Content-Type':'application/json' };
      if (window.__ADMIN_KEY) headers['X-Admin-Key'] = window.__ADMIN_KEY;

      fetch('/api/docs/unified/generate', {
        method:'POST',
        headers: headers,
        body: JSON.stringify({ idSpedizione: idSped, type: type })
      })
      .then(function(r){
        return r.text().then(function(text){
          var json = null; try { json = JSON.parse(text); } catch(e){}
          console.log('[UI] POST /api/docs/unified/generate =>', r.status, r.statusText, { bodySent: { idSpedizione: idSped, type: type }, responseText: text });

          if (!r.ok || (json && json.ok === false)) {
            var msg = (json && json.error) ? json.error : ('HTTP ' + r.status + ' ' + r.statusText);
            say('Errore: ' + msg + '\\n\\nDettagli:\\n' + text.slice(0,800), false);
            return;
          }
          say('Documento generato e allegato ✓\\n\\nDettagli:\\n' + (json ? pretty(json) : text), true);
        });
      })
      .catch(function(e){
        console.error(e);
        say('Errore di rete: ' + (e && e.message ? e.message : 'operazione fallita'), false);
      })
      .finally(function(){ btn.disabled = false; });
    });
  })();
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[tools/docs] 500', now, err);
    return res.status(500).send('Internal Server Error');
  }
}
