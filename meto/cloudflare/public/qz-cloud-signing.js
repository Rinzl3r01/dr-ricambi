/* Private key stays in Worker Secrets. Browser holds only an HttpOnly session. */
(function () {
  let configured=false;
  const messages=new Map();
  async function api(path,data) {
    const response=await fetch(path,{method:data===undefined?"GET":"POST",credentials:"same-origin",cache:"no-store",headers:data===undefined?{}:{"Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||"Firma Cloudflare non disponibile");
    return result;
  }
  function configure() {
    if(configured)return;
    configured=true;
    qz.security.setCertificatePromise((resolve,reject)=>fetch("/certificate/digital-certificate.txt",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("Certificato non disponibile");return r.text();}).then(resolve,reject));
    qz.security.setSignatureAlgorithm("SHA512");
    qz.api.setSha256Type(async raw=>{
      if(messages.size>=32)throw Error("Troppe richieste di firma in attesa");
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
      const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      messages.set(hex,raw);return hex;
    });
    qz.security.setSignaturePromise(hash=>(resolve,reject)=>{
      const message=messages.get(hash);messages.delete(hash);
      if(!message)return reject(Error("Richiesta non riconosciuta"));
      api("/api/qz/sign",{message}).then(data=>resolve(data.signature),reject);
    });
  }
  async function refresh() {
    const status=await api("/api/qz/status");
    if(status.authorized){configure();document.getElementById("certificateState").textContent="Firma attiva";document.getElementById("certificateServerState").textContent="Firma Cloudflare attiva. Nessun modulo Python aggiuntivo richiesto su Odoo.";}
    else {document.getElementById("certificateState").textContent="Firma da attivare";}
    return status;
  }
  window.metoCloudSigning={get configured(){return configured;},ready:refresh().catch(()=>({authorized:false})),async activate(code){
    await api("/api/qz/activate",{code});
    const status=await refresh();if(!status.authorized)throw Error("Il browser non conserva la sessione. Apri METO in una scheda separata e attivalo lì.");
    return status;
  }};
  const channel=new URLSearchParams(location.search).get("channel");
  if(window.parent!==window && channel) {
    const origins=fetch("/config.json",{cache:"no-store"}).then(r=>r.json()).then(c=>c.odooOrigins);
    let automaticActivation=null;
    window.addEventListener("message",async event=>{
      if(event.source!==window.parent || event.data?.type!=="meto:activate" || event.data.channel!==channel) return;
      const allowed=await origins.catch(()=>[]);
      if(!Array.isArray(allowed) || !allowed.includes(event.origin) || typeof event.data.code!=="string" || event.data.code.length<20 || event.data.code.length>128 || automaticActivation) return;
      automaticActivation=(async()=>{
        const status=await window.metoCloudSigning.ready;
        if(!status.authorized) await window.metoCloudSigning.activate(event.data.code);
        document.getElementById("certificateState").textContent="Firma attiva da Odoo";
        window.parent.postMessage({type:"meto:activated",channel},event.origin);
      })().catch(()=>{document.getElementById("certificateState").textContent="Attivazione automatica non disponibile";});
    });
    origins.then(allowed=>{for(const origin of allowed)window.parent.postMessage({type:"meto:activation-ready",channel},origin);}).catch(()=>{});
  }
})();
