import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
test('QZ signing requires the configured Odoo parent, correlates replies and signs exact raw message',async()=>{
 let listener,certPromise,signature,hasher;const sent=[],elements={};
 const parent={postMessage(message,origin){sent.push({message,origin});}};
 const ctx={URLSearchParams,location:{search:'?channel=12345678-1234-1234-123456789012'},crypto:webcrypto,TextEncoder,setTimeout,clearTimeout,
 fetch:async()=>({ok:true,json:async()=>({odooOrigins:['https://drricambi.it']})}),document:{getElementById(id){return elements[id] ||= {}; }},
 qz:{security:{setCertificatePromise(f){certPromise=f;},setSignatureAlgorithm(a){assert.equal(a,'SHA512');},setSignaturePromise(f){signature=f;}},api:{setSha256Type(f){hasher=f;}}}};
 ctx.window={parent,addEventListener(type,fn){listener=fn;}};
 vm.runInNewContext(fs.readFileSync(new URL('../public/qz-signing.js',import.meta.url),'utf8'),ctx);
 await new Promise(r=>setImmediate(r));
 assert.equal(sent[0].message.type,'meto:qz:status');
 const message={type:'meto:qz:available',channel:'12345678-1234-1234-123456789012'};
 listener({source:{},origin:'https://drricambi.it',data:message});assert.equal(certPromise,undefined);
 listener({source:parent,origin:'https://evil.example',data:message});assert.equal(certPromise,undefined);
 listener({source:parent,origin:'https://drricambi.it',data:message});assert.equal(typeof certPromise,'function');
 const raw=JSON.stringify({call:'printers.find',params:{},timestamp:Date.now()});
 const hash=await hasher(raw);const pending=new Promise(signature(hash));
 const request=sent.at(-1).message;assert.equal(request.message,raw);assert.equal(request.operation,'sign');
 listener({source:parent,origin:'https://drricambi.it',data:{type:'meto:qz:response',channel:message.channel,id:request.id,value:'signed'}});
 assert.equal(await pending,'signed');
 await assert.rejects(new Promise(signature(hash)),/non riconosciuta/);
});
