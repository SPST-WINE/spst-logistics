// api/tools/docs.js — Vercel Function (Pages Router)
export default async function handler(req, res) {
  const now = new Date().toISOString();
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).send('Method Not Allowed');
    }

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
      --success:#1ec28b; --danger:#ff6b6b;
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
      border:1px solid var(--line); border-radius:var(--r); padding:18px; width:100%;
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
    .btn{
      border:0; cursor:pointer; padding:14px 18px; border-radius:14px; font-weight:800; letter-spacing:.3px;
      background:linear-gradient(180deg,var(--accent),var(--accent2));
      color:#111; box-shadow:0 6px 18px rgba(255,154,31,.25), inset 0 1px 0 rgba(255,255,255,.3);
      transition:transform .05s, filter .15s, box-shadow .15s;
    }
    .btn:hover{filter:brightness(1.02)} .btn:active{transform:translateY(1px)}
    .btn[disabled]{opacity:.55;cursor:not-allowed;filter:grayscale(.2)}

    .subactions{display:flex; gap:10px; flex-wrap:wrap; margin:10px 0 0}
    .chip{
      border:1px solid var(--line); background:#0b1328; color:#fff;
      border-radius:999px; padding:10px 14px; font-weight:700; letter-spacing:.2px; cursor:pointer;
    }
    .chip:hover{border-color:rgba(255,255,255,.18)}

    .note{margin-top:8px;font-size:13px;color:var(--muted)}
    .log{margin-top:14px;min-height:52px;border-radius:12px;background:#0b1328;border:1px solid var(--line);
         padding:10px 12px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;color:#cfe0ff;white-space:pre-wrap}
    .log.ok{border-color:rgba(30,194,139,.35)}
    .log.err{border-color:rgba(255,107,107,.35)}
    .hidden{display:none}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="page-title">Utility Documenti</div>
    <div class="page-sub">
      Crea <strong>Proforma</strong>, <strong>Fattura commerciale</strong> e <strong>DLE</strong>.
      Il link generato è firmato. Puoi selezionare manualmente il corriere per Proforma/Fattura (override)
      e scegliere il <strong>template DLE</strong> per <b>FedEx</b> o <b>UPS</b>.
    </div>

    <div class="card">
      <div class="row cols-2">
        <div class="field">
          <label for="idsped">ID Spedizione</label>
          <input id="idsped" placeholder="es. SP-2025-09-11-4599 o recXXXXXXXXXXXX" />
        </div>
        <div class="field">
          <label for="tipo">Tipo documento</label>
          <select id="tipo">
            <option value="proforma">Proforma</option>
            <option value="fattura">Fattura commerciale</option>
            <option value="dle">Dichiarazione libera esportazione (DLE)</option>
          </select>
        </div>
      </div>

      <!-- Corriere: override per Proforma/Fattura, scelta template per DLE -->
      <div id="carrierBlock" class="row" style="margin-top:var(--gap);">
        <div class="field">
          <label for="carrier">Corriere — Proforma/Fattura: override · DLE: template (FedEx/UPS)</label>
          <select id="carrier">
            <option value="">Usa valore da Airtable / Generico</option>
            <option value="DHL">DHL</option>
            <option value="UPS">UPS</option>
            <option value="FedEx">FedEx</option>
            <option value="GLS">GLS</option>
            <option value="BRT">BRT</option>
            <option value="Altro">Altro…</option>
          </select>
        </div>
        <div class="field hidden" id="carrierOtherWrap">
          <label for="carrierOther">Specifica corriere</label>
          <input id="carrierOther" placeholder="Es. TNT, ChronoExpress, ecc." />
        </div>
      </div>

      <div class="actions"><button id="go" class="btn">Genera e allega</button></div>
      <div class="subactions">
        <button id="openPreview" class="chip" disabled>Apri anteprima</button>
        <button id="openPrint" class="chip" disabled>Stampa / Salva PDF</button>
        <button id="copyUrl" class="chip" disabled>Copia URL</button>
      </div>
      <div class="note">
        Nota: l’URL firmato scade in ~15 minuti. L’allegato (se configurato) viene salvato su Airtable.
        Per DLE: se selezioni <b>FedEx</b> o <b>UPS</b> verrà usato il relativo template HTML; altrimenti generico.
      </div>
      <div id="log" class="log"></div>
    </div>
  </div>

<script>
(function(){
  var $ = (s, r) => (r||document).querySelector(s);
  var inpId = $('#idsped');
  var selTp = $('#tipo');
  var btn   = $('#go');
  var log   = $('#log');
  var bPrev = $('#openPreview');
  var bPrnt = $('#openPrint');
  var bCopy = $('#copyUrl');
  var lastUrl = '';

  // Carrier UI
  var carrierBlock = $('#carrierBlock');
  var selCarrier = $('#carrier');
  var carrierOtherWrap = $('#carrierOtherWrap');
  var inpCarrierOther = $('#carrierOther');

  function isTypeWithCarrierControl(v){
    // Mostra il blocco per Proforma, Fattura e DLE (per DLE serve a scegliere il template FedEx/UPS)
    return v === 'proforma' || v === 'fattura' || v === 'dle';
  }
  function toggleCarrierUI(){
    var show = isTypeWithCarrierControl(selTp.value);
    carrierBlock.classList.toggle('hidden', !show);
    if (!show) {
      selCarrier.value = '';
      carrierOtherWrap.classList.add('hidden');
      inpCarrierOther.value = '';
    }
  }
  selTp.addEventListener('change', toggleCarrierUI);
  selCarrier.addEventListener('change', function(){
    var needOther = selCarrier.value === 'Altro';
    carrierOtherWrap.classList.toggle('hidden', !needOther);
    if (!needOther) inpCarrierOther.value = '';
  });
  toggleCarrierUI();

  function say(t, ok){
    log.textContent = t || '';
    log.classList.toggle('ok', !!ok);
    log.classList.toggle('err', !ok);
  }
  function pretty(obj){ try { return JSON.stringify(obj, null, 2); } catch(e){ return String(obj); } }
  function validate(){
    var v = (inpId.value || '').trim();
    btn.disabled = !v;
    return !!v;
  }
  inpId.addEventListener('input', validate);
  validate();

  function setActionsEnabled(en){
    [bPrev,bPrnt,bCopy].forEach(b => b.disabled = !en);
  }
  setActionsEnabled(false);

  btn.addEventListener('click', function(){
    if (!validate()) return;

    var idSped = inpId.value.trim();
    var type   = selTp.value;

    // Carrier: override per Proforma/Fattura, template select per DLE
    var carrier = '';
    if (isTypeWithCarrierControl(type)) {
      if (selCarrier.value === 'Altro') carrier = (inpCarrierOther.value || '').trim();
      else carrier = (selCarrier.value || '').trim();

      // Normalizza in lowercase per la backend API
      // Per DLE passiamo solo 'fedex' o 'ups'; gli altri valori verranno ignorati (fallback generico o da Airtable)
      if (type === 'dle') {
        var low = carrier.toLowerCase();
        carrier = (low === 'fedex' || low === 'ups') ? low : '';
      }
    }

    btn.disabled = true;
    setActionsEnabled(false);
    say('Generazione in corso…');

    var payload = { idSpedizione: idSped, type: type };
    if (carrier) payload.carrier = carrier;

    fetch('/api/docs/unified/generate', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r){
      return r.text().then(function(text){
        var json = null; try { json = JSON.parse(text); } catch(e){}
        if (!r.ok || (json && json.ok === false)) {
          var msg = (json && json.error) ? json.error : ('HTTP ' + r.status + ' ' + r.statusText);
          say('Errore: ' + msg + '\\n\\nDettagli:\\n' + text.slice(0,800), false);
          return;
        }
        lastUrl = json.url;
        setActionsEnabled(true);
        say('Link generato ✓\\n\\nDettagli:\\n' + (json ? pretty(json) : text), true);
      });
    })
    .catch(function(e){
      say('Errore di rete: ' + (e && e.message ? e.message : 'operazione fallita'), false);
    })
    .finally(function(){ btn.disabled = false; });
  });

  bPrev.addEventListener('click', function(){
    if (!lastUrl) return;
    window.open(lastUrl + '&format=html', '_blank', 'noopener');
  });
  bPrnt.addEventListener('click', function(){
    if (!lastUrl) return;
    window.open(lastUrl + '&format=print', '_blank', 'noopener');
  });
  bCopy.addEventListener('click', function(){
    if (!lastUrl) return;
    navigator.clipboard.writeText(lastUrl).then(function(){ say('URL copiato negli appunti.\\n' + lastUrl, true); });
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
