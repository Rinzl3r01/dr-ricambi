/* No Odoo credentials, session cookies or product data travel through Cloudflare APIs. */
(async function() {
  "use strict";
  const channel = new URLSearchParams(location.search).get("channel");
  if (window.parent === window || !channel || !/^[a-zA-Z0-9-]{16,80}$/.test(channel)) return;
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Configurazione collegamento Odoo non disponibile");
    const { odooOrigins } = await response.json();
    if (!Array.isArray(odooOrigins) || !odooOrigins.length) throw new Error("Il dominio Odoo non è ancora configurato su Cloudflare");
    let applied = false;
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || !odooOrigins.includes(event.origin)) return;
      const message = event.data;
      if (!message || message.channel !== channel) return;
      if (message.type === "meto:hello") {
        window.parent.postMessage({ type: "meto:ready", channel }, event.origin);
        return;
      }
      if (message.type !== "meto:product" || applied) return;
      const product = message.product;
      if (!product || !["name", "default_code", "barcode"].every(k => product[k] === false || product[k] == null || (typeof product[k] === "string" && product[k].length <= 4096))) return;
      if (canvas.getObjects().some(obj => obj !== mainTextObject) || mainTextObject.text) {
        setStatus("Etichetta già modificata: riapri METO dal prodotto per caricarlo");
        return;
      }
      applied = true;
      mainTextObject.set("text", [product.name, product.default_code].filter(Boolean).join("\n"));
      syncHiddenMainText(); updateMainBoxGeometry();
      $("codeValue").value = product.barcode || product.default_code || "";
      canvas.requestRenderAll(); commitHistorySnapshot();
      setStatus("Prodotto caricato da Odoo. Collega QZ Tray per stampare.");
      window.parent.postMessage({ type: "meto:loaded", channel }, event.origin);
    });
    for (const origin of odooOrigins) window.parent.postMessage({ type: "meto:ready", channel }, origin);
  } catch (error) { setStatus(error.message); }
})();
