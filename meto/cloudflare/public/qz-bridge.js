/* Local QZ connection: never sends printer traffic from the Odoo server. */
(function() {
  "use strict";
  let connecting = null;
  let printing = false;
  const mode = $("connectionMode");
  const host = $("networkHost");
  host.value = localStorage.getItem("meto.qz.networkHost") || "";
  mode.value = localStorage.getItem("meto.qz.mode") || "system";
  function error(err) { setStatus(err && err.message ? err.message : String(err)); }
  async function connect() {
    if (!window.qz) throw new Error("Libreria QZ Tray non disponibile");
    if (qz.websocket.isActive()) return;
    if (!connecting) {
      setStatus("Collegamento a QZ Tray: autorizza la connessione sul PC");
      connecting = qz.websocket.connect({ retries: 1, delay: 1 }).finally(() => { connecting = null; });
    }
    await connecting;
  }
  async function discover() {
    await connect();
    const names = await qz.printers.find();
    updatePrinters(names.map(name => ({ name, ip: name })));
    if (!$("printerSelect").value && names.length) $("printerSelect").selectedIndex = 0;
    setStatus(names.length ? "QZ Tray collegato. Stampanti del PC: " + names.length : "Nessuna stampante configurata sul PC. Puoi usare un IP di rete.");
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
    if (printing) return;
    printing = true; $("printBtn").disabled = true;
    try {
      const target = mode.value === "network" ? { host: networkHost(), port: 9100 } : $("printerSelect").value;
      if (!target) throw new Error("Seleziona una stampante");
      await connect();
      const zpl = await makeZpl(payload);
      setStatus("Invio stampa: conferma l'autorizzazione QZ Tray se richiesta");
      await qz.print(qz.configs.create(target), [{ type: "raw", format: "command", flavor: "plain", data: zpl }]);
      setStatus("Lavoro inviato a QZ Tray. Verifica l'etichetta sulla stampante.");
    } finally { printing = false; $("printBtn").disabled = false; }
  }
  window.metoBridge = { handle(payload) {
    if (payload.type === "discover") discover().catch(error);
    if (payload.type === "print") print(payload).catch(error);
  } };
  $("connectQz").addEventListener("click", () => discover().catch(error));
  function updateMode() {
    $("networkLabel").hidden = mode.value !== "network";
    $("printerSelect").disabled = mode.value === "network";
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
