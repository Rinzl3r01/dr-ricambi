/* Local QZ connection: never sends printer traffic from the Odoo server. */
(function() {
  "use strict";
  let connecting = null;
  let printing = false;
  let discovering = false;
  let systemPrinters = new Set();
  // Names identify the configured METO/Zebra queues; discovery does not send
  // commands to a device or claim to detect its active printer language.
  function isLabelPrinter(name) {
    return typeof name === "string" && /(?:^|[^a-z0-9])(meto|zebra|zdesigner|zpl)(?=$|[^a-z0-9])/i.test(name)
      && !/pdf|onenote|anydesk|xps|fax/i.test(name);
  }
  const knownIps = ["10.0.0.28", "10.0.0.31", "10.0.0.39", "10.0.0.41", "10.0.0.45", "10.0.0.46", "10.0.0.47"];
  const mode = $("connectionMode");
  const host = $("networkHost");
  host.value = localStorage.getItem("meto.qz.networkHost") || "";
  mode.value = localStorage.getItem("meto.qz.mode") || "system";
  function error(err) { setStatus(err && err.message ? err.message : String(err)); }
  async function diagnoseLocalAccess() {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    for (const name of ["loopback-network", "local-network-access"]) {
      try {
        const permission = await navigator.permissions.query({ name });
        const labels = { granted: "consentito", denied: "bloccato: abilitalo nelle informazioni del sito", prompt: "da autorizzare nel browser" };
        $("qzPermission").textContent = "Accesso alle app del dispositivo: " + (labels[permission.state] || permission.state);
        return;
      } catch (_) { /* This browser may use a different permission name. */ }
    }
    $("qzPermission").textContent = "Il browser non espone lo stato del permesso locale. Se non compare alcuna richiesta, controlla le informazioni del sito.";
  }
  async function connect() {
    if (!window.qz) throw new Error("Libreria QZ Tray non disponibile");
    if (connecting) return connecting;
    if (qz.websocket.isActive()) return;
    if (!connecting) {
      setStatus("Collegamento a QZ Tray: autorizza la connessione sul PC");
      diagnoseLocalAccess().catch(() => {});
      $("connectQz").disabled = true;
      let watchdog;
      let expired = false;
      const deadline = new Promise((_, reject) => {
        watchdog = setTimeout(() => {
          expired = true;
          if (qz.websocket.disconnect) qz.websocket.disconnect().catch(() => {});
          reject(new Error("Richiesta di collegamento scaduta dopo 30 secondi"));
        }, 30000);
      });
      const establish = async () => {
        // An HTTPS request triggers the browser's local-app permission on versions
        // where a WebSocket attempt alone stays pending without a visible prompt.
        // Read no response and send no cookies or print data to the QZ health page.
        if (typeof fetch === "function") {
          try {
            await fetch("https://localhost:8181/", { mode: "no-cors", credentials: "omit", cache: "no-store" });
          } catch (_) { /* Alternate QZ ports are still tried by the connector. */ }
        }
        if (expired) throw new Error("Richiesta di collegamento già scaduta");
        return qz.websocket.connect({ retries: 0 });
      };
      connecting = Promise.race([establish(), deadline]).catch(err => {
        throw new Error("QZ Tray non raggiungibile. Verifica che sia avviato e consenti al browser l’accesso alle app di questo dispositivo. Se il permesso è bloccato, apri METO in una scheda separata per verificarlo. Dettaglio: " + (err.message || String(err)));
      }).finally(() => { clearTimeout(watchdog); connecting = null; $("connectQz").disabled = false; });
    }
    await connecting;
    $("connectQz").textContent = "QZ Tray collegato";
  }
  function probeHost(ip, timeoutMs = 15000) {
    // Probe only TCP connection establishment. Never send bytes to a printer.
    return new Promise(resolve => {
      let finished = false;
      const timer = setTimeout(() => {
        finished = true;
        resolve({ ip, reachable: false, reason: "timeout" });
      }, timeoutMs);
      Promise.resolve().then(() => qz.socket.open(ip, 9100)).then(async () => {
        // A late success must also close the socket owned by this probe.
        await qz.socket.close(ip, 9100).catch(() => {});
        if (!finished) {
          finished = true; clearTimeout(timer);
          resolve({ ip, reachable: true });
        }
      }, err => {
        if (!finished) {
          finished = true; clearTimeout(timer);
          resolve({ ip, reachable: false, reason: err.message || String(err) });
        }
      });
    });
  }
  async function discover() {
    if (discovering || printing) return;
    discovering = true; $("discoverBtn").disabled = true;
    const selectedMode = mode.value;
    mode.disabled = true;
    try {
    await connect();
    if (selectedMode === "network") {
      const input = host.value.trim();
      const candidates = [...new Set([...(input ? [networkHost()] : []), ...knownIps])];
      let completed = 0;
      const results = [];
      const queue = [...candidates];
      setStatus("Ricerca rete: autorizza QZ Tray se richiesto. Controllo IP METO configurati, senza stampare.");
      async function probeQueue() {
        while (queue.length) {
          const ip = queue.shift();
          results.push(await probeHost(ip));
          completed++;
          setStatus(`Ricerca rete: ${completed}/${candidates.length} IP controllati. Raggiungibili: ${results.filter(r => r.reachable).length}`);
        }
      }
      await Promise.all([probeQueue(), probeQueue()]);
      const found = results.filter(r => r.reachable);
      updatePrinters(found.map(r => ({ ip: r.ip, name: "METO / porta 9100" })));
      if (found.length) {
        const preferred = found.find(r => r.ip === input) || found[0];
        $("printerSelect").value = preferred.ip; host.value = preferred.ip;
        localStorage.setItem("meto.qz.networkHost", preferred.ip);
      }
      setStatus(found.length ? `Rete: ${found.length} indirizzi con porta 9100 raggiungibile. Seleziona quello dell’etichettatrice.` : "Nessuna connessione confermata agli IP METO configurati. Controlla indirizzo, rete e autorizzazioni QZ; un rifiuto o timeout non prova che la stampante sia spenta.");
      return;
    }
    const names = [...new Set((await qz.printers.find()).filter(isLabelPrinter))];
    systemPrinters = new Set(names);
    updatePrinters(names.map(name => ({ name, ip: name })));
    if (!$("printerSelect").value && names.length) $("printerSelect").selectedIndex = 0;
    setStatus(names.length ? "QZ Tray collegato. Etichettatrici METO / Zebra / ZPL: " + names.length : "Nessuna etichettatrice METO / Zebra / ZPL trovata. Controlla il nome della coda sul PC oppure usa un IP di rete.");
    } finally { discovering = false; $("discoverBtn").disabled = false; mode.disabled = false; }
  }
  function networkHost() {
    const value = host.value.trim();
    const parts = value.split(".");
    if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) throw new Error("Inserisci un indirizzo IPv4 valido");
    localStorage.setItem("meto.qz.networkHost", value);
    return value;
  }
  async function makeZpl(payload) {
    if (![25, 30, 100].includes(payload.heightMm) || ![55, 70, 100].includes(payload.widthMm)) throw new Error("Formato non valido");
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Immagine non valida")); image.src = payload.image; });
    const width = Math.round(payload.widthMm / 25.4 * 203);
    const height = Math.round(payload.heightMm / 25.4 * 203);
    const raster = document.createElement("canvas");
    raster.width = width; raster.height = height;
    const ctx = raster.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    const shift = payload.widthMm === 70 && payload.heightMm === 30 ? Math.round(3 / 25.4 * 203) : 0;
    ctx.drawImage(image, shift, 0, width - shift, height);
    return metoRasterZpl(ctx.getImageData(0,0,width,height).data, width, height);
  }
  async function print(payload) {
    if (discovering) { setStatus("Attendi il completamento della ricerca prima di stampare"); return; }
    if (printing) return;
    printing = true; $("printBtn").disabled = true;
    try {
      const target = mode.value === "network" ? { host: networkHost(), port: 9100 } : $("printerSelect").value;
      if (!target) throw new Error("Seleziona una stampante");
      if (mode.value !== "network" && !systemPrinters.has(target)) throw new Error("Cerca e seleziona un’etichettatrice METO / Zebra / ZPL");
      await connect();
      const zpl = await makeZpl(payload);
      setStatus("Invio stampa: conferma l'autorizzazione QZ Tray se richiesta");
      await qz.print(qz.configs.create(target), [{ type: "raw", format: "command", flavor: "plain", data: zpl }]);
      setStatus("Lavoro inviato a QZ Tray. Verifica l'etichetta sulla stampante.");
    } finally { printing = false; $("printBtn").disabled = false; }
  }
  window.metoBridge = { handle(payload) {
    if (payload.type === "discover") return discover().catch(error);
    if (payload.type === "print") return print(payload).catch(error);
  } };
  $("connectQz").addEventListener("click", () => connect().then(() => setStatus("QZ Tray collegato. Premi Cerca stampanti PC o Cerca rete, oppure inserisci l’IP e stampa.")).catch(error));
  $("testNetworkIp").addEventListener("click", async () => {
    if (printing || discovering) return;
    $("testNetworkIp").disabled = true;
    try {
      const ip = networkHost(); await connect();
      setStatus(`Verifica ${ip}:9100: autorizza QZ Tray se richiesto. Nessuna stampa inviata.`);
      const result = await probeHost(ip);
      setStatus(result.reachable ? `${ip}:9100 raggiungibile tramite QZ Tray. Nessuna stampa inviata.` : `QZ non ha confermato ${ip}:9100. Controlla il permesso QZ e la rete. Dettaglio: ${result.reason}`);
    } catch (err) { error(err); }
    finally { $("testNetworkIp").disabled = false; }
  });
  host.addEventListener("change", () => localStorage.setItem("meto.qz.networkHost", host.value.trim()));
  $("printerSelect").addEventListener("change", () => {
    if (mode.value === "network" && $("printerSelect").value) {
      host.value = $("printerSelect").value;
      localStorage.setItem("meto.qz.networkHost", host.value);
    }
  });
  function updateMode() {
    $("networkLabel").hidden = mode.value !== "network";
    $("testNetworkIp").hidden = mode.value !== "network";
    $("discoverBtn").textContent = mode.value === "network" ? "Cerca rete" : "Cerca PC";
    $("printerSelect").disabled = false;
    updatePrinters([]);
    localStorage.setItem("meto.qz.mode", mode.value);
  }
  mode.addEventListener("change", updateMode); updateMode();
  $("exportZpl").addEventListener("click", async () => {
    try {
      canvas.discardActiveObject(); canvas.renderAll();
      const p = currentPreset();
      const image = canvas.toDataURL({ format: "png", multiplier: (203/25.4)/state.scale, enableRetinaScaling: false });
      const zpl = await makeZpl({ image, widthMm: p.width, heightMm: p.height });
      const url = URL.createObjectURL(new Blob([zpl], { type: "text/plain" }));
      const link = document.createElement("a"); link.href = url; link.download = "meto-etichetta.zpl"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("File ZPL scaricato. Nessuna stampa inviata.");
    } catch (err) { error(err); }
  });
})();
