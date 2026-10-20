# Firma QZ METO

Questo addon richiede installazione sul server Odoo, con cryptography recente (>=42). Non si installa con Importa modulo XML. Dipende dal modulo meto_label_editor esistente.

Installare il codice nel percorso addons, aggiornare la lista applicazioni e installare METO QZ Signing. Impostare per il processo Odoo METO_QZ_PRIVATE_KEY al file PEM PKCS8 privato custodito fuori dagli addon e leggibile solo dall’utente del servizio (permessi 0600). La chiave non è nel repository: trasferirla separatamente e in modo protetto. Riavviare Odoo.

Assegnare il gruppo METO: firma stampe QZ ai soli utenti autorizzati. METO_QZ_PRINTER_NAMES contiene le code Windows autorizzate separate da |, predefinite Meto 39|Zebra 30. Gli IP autorizzati sono i sette IP METO già configurati.

Non esiste un endpoint anonimo Cloudflare di firma. La richiesta passa dal parent Odoo con controlli origin/source/channel e RPC autenticata. Il server controlla gruppo, timestamp, chiamate ammesse, destinazione, raster ZPL e dimensioni; firma con RSA PKCS1v15 SHA512 il digest SHA256 esadecimale previsto dalla libreria QZ. Chiave e certificato devono corrispondere ed essere validi.

Il pacchetto pubblico per i PC è meto/cloudflare/public/certificate/meto-qz-pc.zip. Configurare fiducia QZ solo dopo aver verificato le integrazioni esistenti. Il certificato non va aggiunto allo store radici Windows.

Collaudo locale: politica delle richieste e firma verificabili senza Odoo. Il collaudo RPC, installazione server e stampa fisica richiedono accesso al server e QZ configurato. Il frontend mantiene le richieste con conferma finché l’addon non è disponibile.
