GPT README

---

# SPST — Quotes + Back Office (Tracking) — Handover

Sei il mio assistente tecnico. Mantieni e fai evolvere il sistema **Preventivi** e il **Back-Office Spedizioni** (Next.js/Vercel + Airtable + Resend + frontend statico). Qui trovi architettura, file, env, mappature Airtable e flussi. Quando proponi fix/snippets, **rispetta questa struttura** e non introdurre dipendenze inutili.

## Architettura (alto livello)

* **Hosting**: Vercel (Serverless/Edge a seconda della route).
* **DB**: Airtable.
* **Email**: Resend.
* **Rendering pubblico (quotes)**: HTML server-side (niente React).
* **Back-Office Spedizioni**: interfaccia statica (ESM) che parla con proxy API su Vercel.
* **CORS**: allowlist via env.

---

## Struttura repo (cartelle principali)

```
/api
  /quotes
    /view/[slug].js             # Pagina pubblico preventivo + pulsanti Accetta
    accept.js                   # POST: accetta opzione, aggiorna Airtable + email
  /notify/transit.js            # POST: email "Spedizione in transito" (Resend) — usata dal Back-Office

/app
  /api/spedizioni/[id]/notify/route.ts  # Email "Spedizione confermata" (stile coerente) — usata dalla web app

/assets/esm
  main.js                       # Data flow + azioni (upload, tracking, notify, evasione)
  /ui/render.js                 # Render card spedizione (alias robusti campi, fallback colli/peso)
  /airtable/api.js              # Proxy wrapper fetch/patch su Airtable
  /rules/docs.js                # Regole documenti richiesti + note
  /rules/labels.js              # Pannello etichette
  /utils/*                      # date/format/dom/misc
  config.js                     # CARRIERS, TEMPLATES, API_BASE (proxy)
```

> NB: il Back-Office gira come pagina statica (es. su `spst.it/back-office`) e chiama le API Vercel via **proxy**.

---

## Variabili d’ambiente (Vercel → Project Settings → Environment Variables)

### Comuni

* `AIRTABLE_BASE_ID`
* `AIRTABLE_PAT` *(scoped PAT per le tabelle sotto)*
* `ORIGIN_ALLOWLIST` *(CSV origini per CORS — es. `https://spst.it,https://*.vercel.app,http://localhost:*`)*

### Preventivi

* `TB_PREVENTIVI` *(es. `Preventivi`)*
* `TB_OPZIONI` *(es. `OpzioniPreventivo`)*
* `TB_COLLI` *(es. `Colli`)*
* `MAIL_FROM` *(default `SPST Notifications <notification@spst.it>`)*
* `PUBLIC_QUOTE_BASE_URL` *(default `https://<deploy>/quote`)*

### Spedizioni / Notifiche

* `RESEND_API_KEY`
* `EMAIL_FROM` *(default `notification@spst.it`)*
* `EMAIL_LOGO_URL` *(es. `https://www.spst.it/logo-email.png`)*
* `AREA_RISERVATA_URL` *(es. `https://www.spst.it/area-riservata`)*
* `WHATSAPP_URL` *(link supporto; es. `https://wa.me/39...`)*

### Web-app “conferma spedizione”

* `APP_DASHBOARD_URL` *(es. `https://app.spst.it/dashboard`)*

---

## Airtable — mappature campi (alias robusti)

Usiamo helper `pickLoose()` per tollerare varianti/typo; **non** rinominare campi a caso senza aggiornare gli alias.

### Preventivi (`TB_PREVENTIVI`)

* Identificativo pubblico: `Slug_Pubblico`
* Client: `Email_Cliente`
* Valuta: `Valuta` / `Currency`
* Validità: `Valido_Fino_Al` / `Valid_Until` / `Validita`
* **Note generiche spedizione**: `Note generiche sulla spedizione` / `Note_Spedizione` / `Shipment_Notes` / `Note spedizione`
* Stato: `Stato` *(Bozza | Pubblicato | Accettato | Scaduto | Annullato)*
* Accettazione: `Opzione_Accettata`, `Accettato_Il`, `Accettato_IP`, `Accettato_UA`
* Mittente/Destinatario + P.IVA/EORI/Tax → vari alias (`Mittente_*`, `Destinatario_*`, `*_Tax`…)

### OpzioniPreventivo (`TB_OPZIONI`)

* Link a preventivo: `Preventivo` (link) o `Preventivo_Id` (testo)
* Indice: `Indice` / `Index` / `Opzione` / `Option`
* Dati: `Corriere`, `Servizio`, `Tempo_Resa`, `Incoterm`, `Oneri_A_Carico`
* Prezzo: `Prezzo` (number), `Valuta`
* Flag: `Consigliata` (bool), `Accettata` (opz.)

### Colli (`TB_COLLI`)

* Link: `Preventivo` o `Preventivo_Id`
* Qty/Dim/Peso: `Quantità|Quantita|Qty`, `L|Lunghezza|L_cm`, `W|Larghezza|W_cm`, `H|Altezza|H_cm`, `Peso|Peso_Kg|Kg|Weight`

### **Spedizioni** (Back-Office)

* ID: `ID Spedizione` (fallback `rec.id`)
* Email cliente: `Creato da` / `Creato da email` / `Mail Cliente`
* **Stato**: `Stato` *(nuovo)* — fallback legacy `Stato Spedizione` (bool → `Evasa`)
* Ritiro: `Ritiro - Data` / `Ritiro – Data` / `Data Ritiro`
* Incoterm: `Incoterm`
* Tipo: `Sottotipo` / `Tipo Spedizione` *(“Sample”→*Campionatura*)*
* Tracking: `Tracking Number`, `Tracking URL`, `Corriere`
* Peso: `Peso reale tot` / `Peso tariffato tot` / `Peso reale` / `Peso` / `Peso (kg)`
* **Colli**:

  * primario: `Lista Colli Ordinata` / `Lista Colli` / `Contenuto Colli`
  * fallback “Altro”: `Dimensioni (cm)` / `L×W×H` / `LxWxH` (anche separati `L|W|H`) e `Peso`
* Import: `Destinatario abilitato import` / alias simili → boolean
* **Documenti**:

  * LDV: `Allegato LDV` / `Lettera di Vettura`
  * Fattura: `Allegato Fattura` (fallback cliente: `Fattura - Allegato Cliente`)
  * DLE: `Allegato DLE` / `Dichiarazione Esportazione`
  * PL: `Allegato PL` / `Packing List` (fallback cliente)
  * Extra: `Allegato 1/2/3` → **Proforma**, **FDA Prior Notice**, **e-DAS** (priorità elastica)

---

## Flussi & comportamenti

### Preventivi (pubblico)

* `/api/quotes/view/[slug].js` genera pagina HTML (dark), con:

  * intestazione stato (Valido fino al… / Accettato),
  * dati mittente/destinatario + P.IVA/Tax,
  * **Note generiche spedizione**,
  * tabella **Colli**,
  * card **Opzioni** con badge “Consigliata” e bottone **Accetta**.
* **Accettazione** (`POST /api/quotes/accept`): idempotente; aggiorna campi accettazione + invia email via Resend (cliente + interno).

### Back-Office Spedizioni

* **Card** compresse di default (bottone “Espandi record”).
* Pulsanti **“Verifica etichette”** e **“Espandi record”** in alto a destra.
* **Filtro “Solo non evase”**: quando attivo **mostra solo** spedizioni con `Stato = "Nuova"`. È **attivo di default** all’apertura.
* **Salva tracking**: salva `Corriere` + `Tracking Number` **ma non cambia** lo stato. Abilita il bottone “Invia mail”.
* **Invia mail (transito)**: input email sempre editabile; **bottone** abilitato solo se tracking presente.

  * Dopo l’invio mostriamo **“Email inviata ✓”** e disabilitiamo input+button per evitare doppioni (flag **solo in sessione**).
* **Evasione completata**: imposta `Stato = "In transito"`. Con filtro attivo la card **scompare** dopo l’azione.
* **Altro (tipo spedizione)**: se i colli non arrivano nella lista strutturata, ricostruiamo da `Dimensioni (cm)` / `LxWxH` / `L|W|H` + `Peso` (fix per “-×-×- cm / 0.0 kg”).

---

## Email templates (Resend)

### 1) Spedizione **in transito** — usata dal Back-Office

**Endpoint:** `POST /api/notify/transit`
**Body:** `{ to, id, carrier, tracking, ritiroData }`
**Stile:** coerente con il design “conferma spedizione”; **link neri**, **niente link tracking**, CTA:

* **Area Riservata** → `AREA_RISERVATA_URL`
* **Supporto WhatsApp** → `WHATSAPP_URL`

> Il file è **`/api/notify/transit.js`**. Mantieni solo lo **stile HTML** se cambi design; la logica CORS e il plain-text vanno lasciati identici.

### 2) Spedizione **confermata** — usata dalla web-app

**Endpoint:** `POST /app/api/spedizioni/[id]/notify/route.ts`
Usa brand colors e pulsanti coerenti; ha preheader e footer brandizzati. Env: `APP_DASHBOARD_URL`, `EMAIL_LOGO_URL`, ecc.

---

## API proxy & CORS

* Route serverless espongono CORS con allowlist letta da `ORIGIN_ALLOWLIST`.
* Il Back-Office chiama le API tramite `API_BASE` derivato da `AIRTABLE.proxyBase` (se presente) o default `https://<project>.vercel.app/api`.
* Errore tipico: **405 Not Allowed** → chiamata con metodo sbagliato o dominio non in allowlist.

---

## File & responsabilità (Back-Office)

### `assets/esm/main.js`

* Carica dati (`fetchShipments`), applica filtro **Solo non evase**, ordina per `ritiro_data`.
* Azioni:

  * `onUploadForDoc` → carica allegato e patcha Airtable.
  * `onSaveTracking` → salva corriere/TN, abilita invio mail (non cambia stato).
  * `onSendMail` → chiama `/api/notify/transit`; flag **\_mailSent** per evitare doppioni UI.
  * `onComplete` → setta `Stato = "In transito"` e ricarica lista.

### `assets/esm/ui/render.js`

* **normalizeShipmentRecord** con alias robusti (mittente/destinatario, stato, tracking, docs, peso, colli).
* **Fallback colli/peso** per spedizioni “Altro”.
* Card:

  * header con ID chip, cliente, badge stato;
  * blocchi KV, documenti richiesti, pannello etichette;
  * blocco tracking (select corriere, input TN, “Apri tracking”);
  * sezione **Notifica cliente** (input sempre editabile; bottone attivo solo con tracking; helper “Email inviata ✓”);
  * pulsante **Evasione completata**.
* **Dettagli** compressi di default, con toggle.

> Se rinomini un campo in Airtable, **aggiorna gli alias** in `render.js` (helper `pickLoose`) o nelle regole in `/rules`.

---

## Endpoint utili / test rapidi

```bash
# Preventivo pubblico
GET https://<deploy>/quote/<slug>

# Accetta un’opzione
curl -X POST https://<deploy>/api/quotes/accept \
  -H "Content-Type: application/json" \
  -d '{"slug":"q-250827-xxxx","optionIndex":1}'

# Email "in transito" (Back-Office)
curl -X POST https://<deploy>/api/notify/transit \
  -H "Content-Type: application/json" \
  -d '{"to":"user@example.com","id":"SP-2025-09-04-2000","carrier":"DHL","tracking":"324238592034","ritiroData":"2025-09-04"}'
```

---

## Troubleshooting

* **405 Not Allowed** su `/api/notify/transit`: controlla metodo POST e **ORIGIN\_ALLOWLIST**.
* **Niente colli/peso su “Altro”**: assicurati che almeno uno tra `Dimensioni (cm)`, `LxWxH` o `L|W|H` sia presente, e che `Peso` sia numerico; il fallback li ricompone.
* **Doppia email**: il Back-Office disabilita input/bottone dopo l’invio nella **sessione corrente**. Se vuoi persistenza, salva un flag in Airtable e leggi quel campo in `render.js`.
* **Filtro “Solo non evase”**: mostra **solo `Stato = "Nuova"`**; la card scompare quando premi **Evasione completata**.

---

## Sicurezza & qualità

* CORS rigoroso su tutte le route pubbliche.
* Sanitizzazione HTML (quotes view) via `esc()`.
* PAT Airtable **solo server-side**.
* Accettazione preventivi **idempotente** (`409` su conflitti).
* Logging mirato nelle serverless (senza dati sensibili oltre l’email).

---

## Estensioni future

* Flag “email inviata” persistente su Airtable (evita doppioni tra sessioni).
* PDF generati (LDV/PL/Conferma) con storage in Airtable.
* Rate-limit per `/api/notify/transit`.
* Refactor helpers comuni in `/lib`.

---

### Cosa mi aspetto in chat

* Se tocchiamo Airtable, **aggiorna alias** in `pickLoose`/normalizzatori.
* Se tocchiamo le email, rispetta gli HTML in `/api/notify/transit.js` e in `app/api/spedizioni/.../route.ts`.
* Suggerisci verifiche su log Vercel quando qualcosa non torna (già presenti `console.log` utili).

**Done.** Questo README è la base per manutenzione ed evoluzioni senza perdere il contesto delle chat.
