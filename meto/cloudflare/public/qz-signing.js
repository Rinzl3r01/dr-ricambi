/* Signing is available only through the authenticated Odoo parent and signer addon. */
(async function () {
  const channel = new URLSearchParams(location.search).get("channel");
  if (window.parent === window || !channel) return;
  const response = await fetch("/config.json", {cache:"no-store"});
  if (!response.ok) return;
  const {odooOrigins} = await response.json();
  if (!Array.isArray(odooOrigins)) return;
  const pending = new Map(), messages = new Map();
  let parentOrigin, configured = false;
  function request(operation, message) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {pending.delete(id); reject(Error("Firma Odoo scaduta"));}, 15000);
      pending.set(id, {resolve,reject,timer});
      window.parent.postMessage({type:"meto:qz:request",channel,id,operation,message},parentOrigin);
    });
  }
  window.addEventListener("message", event => {
    if(event.source !== window.parent || !odooOrigins.includes(event.origin) || event.data?.channel !== channel) return;
    if(event.data.type === "meto:qz:response") {
      const item = pending.get(event.data.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(event.data.id);
      event.data.error ? item.reject(Error(event.data.error)) : item.resolve(event.data.value);
    }
    if(event.data.type !== "meto:qz:available" || configured) return;
    configured = true; parentOrigin = event.origin;
    qz.security.setCertificatePromise((resolve,reject) => request("certificate").then(resolve,reject));
    qz.security.setSignatureAlgorithm("SHA512");
    qz.api.setSha256Type(async raw => {
      if(messages.size >= 32) throw Error("Troppe richieste di firma in attesa");
      const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
      const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
      messages.set(hex,raw); return hex;
    });
    qz.security.setSignaturePromise(hash => (resolve,reject) => {
      const raw = messages.get(hash); messages.delete(hash);
      if (!raw) return reject(Error("Richiesta di firma non riconosciuta"));
      request("sign",raw).then(resolve,reject);
    });
    document.getElementById("certificateServerState").textContent = "Firma Odoo disponibile. Resta da configurare la fiducia QZ su questo PC.";
    document.getElementById("certificateState").textContent = "Firma Odoo disponibile. Configura QZ su questo PC con il certificato pubblico METO.";
  });
  for (const origin of odooOrigins) window.parent.postMessage({type:"meto:qz:status",channel},origin);
})().catch(() => {});
