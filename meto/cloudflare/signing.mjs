const encoder = new TextEncoder();
const ips = new Set([28,31,39,41,45,46,47].map(n => `10.0.0.${n}`));
const json = (data,status=200,headers={}) => Response.json(data,{status,headers:{"Cache-Control":"no-store",...headers}});
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = text => Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function equal(a,b) {
  const hash = async text => new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(text)));
  const x=await hash(a), y=await hash(b);let diff=0;
  for(let i=0;i<x.length;i++)diff |= x[i]^y[i]; return diff===0;
}
async function hmac(key,data) {
  const k=await crypto.subtle.importKey("raw",encoder.encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return b64(await crypto.subtle.sign("HMAC",k,encoder.encode(data)));
}
function configured(env) {return !!(env.QZ_PRIVATE_KEY && env.QZ_ENROLLMENT_CODE && env.QZ_SESSION_KEY);}
async function session(request,env) {
  const token=(request.headers.get("Cookie")||"").split(";").map(v=>v.trim()).find(v=>v.startsWith("__Host-meto-qz="))?.slice(15);
  if(!token || token.length>512) return null;
  const [payload,signature,...rest]=token.split(".");
  if(rest.length || !payload || !signature || !await equal(await hmac(env.QZ_SESSION_KEY,payload),signature))return null;
  try {const info=JSON.parse(new TextDecoder().decode(unb64(payload)));return typeof info.id==="string" && info.exp>Date.now() && info.exp<=Date.now()+31*86400000 ? info : null;}catch{return null;}
}
async function body(request,max) {
  if(!request.body)throw Error("Corpo mancante");
  const reader=request.body.getReader();let length=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw Error("Richiesta troppo grande");}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function validateMessage(raw,names=["Meto 39","Zebra 30"],now=Date.now()) {
  if(typeof raw!=="string" || encoder.encode(raw).length>2000000)throw Error("Richiesta troppo grande");
  const msg=JSON.parse(raw), same=(obj,keys)=>obj && typeof obj==="object" && !Array.isArray(obj) && Object.keys(obj).sort().join(",")===keys.sort().join(",");
  if(!same(msg,["call","params","timestamp"]) || typeof msg.timestamp!=="number" || !Number.isFinite(msg.timestamp) || Math.abs(now-msg.timestamp)>60000)throw Error("Richiesta non valida o scaduta");
  const p=msg.params;
  if(msg.call==="printers.find" && (p===null || same(p,[])))return;
  if(!p || typeof p!=="object" || Array.isArray(p))throw Error("Parametri non validi");
  if(["socket.open","socket.close"].includes(msg.call)) {
    if(Object.keys(p).some(k=>!["host","port","options"].includes(k)) || !ips.has(p.host) || p.port!==9100 || (p.options!=null && !same(p.options,[])))throw Error("Destinazione non autorizzata");
    return;
  }
  if(msg.call!=="print" || !same(p,["printer","options","data"]))throw Error("Operazione non autorizzata");
  const target=p.printer;
  if(!((same(target,["host","port"]) && ips.has(target.host) && target.port===9100) || (same(target,["name"]) && names.includes(target.name))))throw Error("Stampante non autorizzata");
  if(!p.options || typeof p.options!=="object" || Array.isArray(p.options) || (p.options.copies??1)!==1 || p.options.spool!=null || p.options.forceRaw===true || p.options.encoding!=null)throw Error("Opzioni non consentite");
  if(!Array.isArray(p.data) || p.data.length!==1 || !same(p.data[0],["type","format","flavor","data"]))throw Error("Dati non validi");
  const job=p.data[0];
  if(job.type!=="raw" || job.format!=="command" || job.flavor!=="plain" || typeof job.data!=="string")throw Error("Solo raster METO");
  const match=/^\^XA\n\^FO0,0\n\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\n\^FS\n\^XZ\n$/.exec(job.data);
  if(!match || match[0].length!==job.data.length || +match[1]!==+match[2] || +match[1]*2!==match[4].length || !["55:11000","70:16800","100:79900"].includes(`${+match[3]}:${+match[1]}`))throw Error("Raster non valido");
}
let keyPem, keyPromise;
async function sign(raw,pem) {
  if(pem!==keyPem){keyPem=pem;keyPromise=crypto.subtle.importKey("pkcs8",unb64(pem.replace(/-----[^-]+-----/g,"").replace(/\s/g,"")),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-512"},false,["sign"]);}
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(raw)));
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  return b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",await keyPromise,encoder.encode(hex)));
}
export async function signingRoute(request,env) {
  const url=new URL(request.url), path=url.pathname;
  if(!["/api/qz/status","/api/qz/activate","/api/qz/sign"].includes(path))return json({error:"Not found"},404);
  if(!configured(env))return json({enabled:false,authorized:false},503);
  if(path==="/api/qz/status" && request.method==="GET")return json({enabled:true,authorized:!!await session(request,env)});
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  if(request.headers.get("Origin")!==url.origin || !request.headers.get("Content-Type")?.startsWith("application/json"))return json({error:"Origine richiesta non consentita"},403);
  const ip=request.headers.get("CF-Connecting-IP")||"unknown";
  if(path==="/api/qz/activate") {
    if(!env.QZ_LOGIN_LIMITER || !(await env.QZ_LOGIN_LIMITER.limit({key:ip})).success)return json({error:"Troppi tentativi. Riprova tra un minuto."},429);
    let data;try{data=await body(request,1024);}catch{return json({error:"Richiesta non valida"},400);}
    if(typeof data.code!=="string" || !await equal(data.code,env.QZ_ENROLLMENT_CODE))return json({error:"Codice non valido"},401);
    const payload=b64(encoder.encode(JSON.stringify({id:crypto.randomUUID(),exp:Date.now()+30*86400000})));
    const token=payload+"."+await hmac(env.QZ_SESSION_KEY,payload);
    return json({authorized:true},200,{"Set-Cookie":`__Host-meto-qz=${token}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=2592000`});
  }
  const auth=await session(request,env);if(!auth)return json({error:"Attiva questo browser dal pannello certificato"},401);
  if(!env.QZ_SIGN_LIMITER || !(await env.QZ_SIGN_LIMITER.limit({key:auth.id})).success)return json({error:"Troppe richieste di stampa. Attendi un minuto."},429);
  let data;try{data=await body(request,2100000);validateMessage(data.message,(env.QZ_PRINTER_NAMES||"Meto 39|Zebra 30").split("|"));}catch{return json({error:"Operazione, stampante o raster non autorizzati"},400);}
  try{return json({signature:await sign(data.message,env.QZ_PRIVATE_KEY)});}catch{return json({error:"Firma non disponibile"},503);}
}
