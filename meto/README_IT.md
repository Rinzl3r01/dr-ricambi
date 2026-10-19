# METO Label Editor — integrazione Odoo 19 + Cloudflare

METO serve a comporre e stampare etichette per ricambi: testo, SKU, barcode, QR, immagini, linee e riquadri. L'editor deriva dal progetto Windows dell'utente; la nuova versione usa il browser e QZ Tray sul PC.

## Architettura
- `cloudflare/`: editor HTML/JS/CSS, conversione ZPL nel browser, Worker per configurazione e intestazioni di sicurezza.
- `meto_label_editor/`: piccolo addon Odoo 19, icona METO e Azioni > Apri in METO nei prodotti/varianti.
- Il controller Python resta in Odoo e legge solo l'URL configurato; non esegue editor o stampa. Non serve un backend Python Cloudflare per le funzioni attuali.
- I dati prodotto sono letti con il servizio ORM dell'utente Odoo e passati direttamente al riquadro Cloudflare tramite postMessage, controllando origine, finestra e canale casuale. Non sono inseriti negli URL o inviati alle API del Worker.
- QZ gira sul PC e raggiunge stampanti locali/raw o IP:9100. Il server Odoo e Cloudflare non devono accedere alla LAN.

## Configurare e distribuire Cloudflare
1. In `cloudflare/wrangler.jsonc`, impostare `vars.ODOO_ORIGINS` con l'origine HTTPS reale di Odoo, ad esempio `https://odoo.azienda.it` (esempio, non un dominio già configurato). Per staging e produzione separare le origini con virgola. Nessun asterisco o percorso.
2. Nella directory `cloudflare`: `npm install`, `npx wrangler login`, poi `npm run deploy`. Il primo accesso va completato dal proprietario dell'account.
3. Annotare l'URL HTTPS effettivamente restituito da Cloudflare. La versione standalone funziona anche senza ODOO_ORIGINS; l'incorporamento è bloccato finché non si configura l'origine.
4. Impostare un dominio dedicato, se desiderato, tramite Cloudflare e usare quello anche in Odoo.

## Installare stabilmente in Odoo (Stefano)
1. Aggiungere l'intera directory `meto_label_editor` agli addon effettivamente caricati dal server Odoo 19.
2. Riavviare i processi Odoo e installare/aggiornare l'addon. L'importazione ZIP dall'interfaccia non sostituisce il deploy del codice Python.
3. In Impostazioni > Tecnico > Parametri di sistema creare `meto_label_editor.editor_url` con l'origine HTTPS effettiva dell'editor (senza percorsi, query o credenziali).
4. Se esiste una CSP aziendale sul dominio Odoo, consentire l'origine Cloudflare in frame-src. Non disabilitare globalmente le protezioni.
5. Aprire METO, poi una variante prodotto > Azioni > Apri in METO; verificare nome, SKU e barcode nel campo Codici. Il barcode si aggiunge esplicitamente con Aggiungi codice.
6. Avviare QZ Tray sul PC, premere Collega QZ Tray e autorizzare. Provare prima Scarica ZPL, poi una sola etichetta fisica.

Se il vecchio addon è già installato, mantenere il nome tecnico `meto_label_editor` e aggiornarlo alla versione 19.0.2.0.0. La nuova azione non usa `/meto/editor`, che restituiva 404 se il controller non veniva caricato.

## Funzioni e limiti
Formati 55×25, 70×30 e 100×100 mm; 203 dpi; correzione di 3 mm a destra su 70×30 come nell'originale. Code128, Code39, EAN-13 e QR. Immagini con soglia/dithering, testo diretto, allineamento, margini, ridimensionamento oggetti, annulla/ripristina. Download ZPL senza stampa.
Le stampanti devono accettare ZPL e i driver del PC raw. QZ usa conferme di sicurezza: la firma per stampa senza conferme non è inclusa e richiede certificato e un servizio di firma protetto. Non conservare mai chiavi private negli asset pubblici.
Non viene salvato un archivio etichette nel database. L'editor pubblico non contiene segreti o dati prodotto precaricati. Se si desidera limitare anche l'accesso al solo editor, valutare Cloudflare Access con attenzione all'autenticazione nei riquadri cross-site.

## Validazione
Eseguire `cd cloudflare && npm run check` per Worker e protocollo. Test ZPL di regressione nella cartella cloudflare/tests. Verificare installazione su staging Odoo 19 e QZ sul PC prima della produzione: il repository pubblico di Stefano contiene addon storici, non prova che master sia collegato al server corrente.
Gli screenshot sono anteprime reali del frontend locale con dati dimostrativi, non prove di installazione sul server o di stampa fisica.

## Componenti terzi
Fabric.js 5.3.0, JsBarcode 3.12.1, QRCode dalla distribuzione METO originale; QZ JS 2.2.5 dall'installazione locale. Conservare avvisi e licenze. QZ_LICENSE.txt è incluso.

## Anteprime

![Testo e barcode](docs/screenshots/01-editor-barcode.jpg)

![QR e stampa di rete](docs/screenshots/02-qr-stampa-rete.jpg)
