import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
test('Odoo activation checks parent, origin, channel, activates once and uses no public embedded secret',async()=>{
 const listeners=[],sent=[],calls=[],elements={};let authorized=false;
 const parent={postMessage(message,origin){sent.push({message,origin});}};
 const ctx={URLSearchParams,location:{search:'?channel=12345678-1234-1234-1234-123456789012'},crypto:webcrypto,TextEncoder,
 document:{getElementById(id){return elements[id] ||= {}; }},qz:{security:{setCertificatePromise(){},setSignatureAlgorithm(){},setSignaturePromise(){}},api:{setSha256Type(){}}},
 fetch:async(path,options={})=>{calls.push(path);if(path==='/config.json')return {json:async()=>({odooOrigins:['https://drricambi.it']})};if(path==='/api/qz/activate'){assert.equal(JSON.parse(options.body).code,'test-private-code-for-test-only');authorized=true;}return {ok:true,json:async()=>({authorized,enabled:true})};}};
 ctx.window={parent,addEventListener(type,fn){listeners.push(fn);}};
 vm.runInNewContext(fs.readFileSync(new URL('../public/qz-cloud-signing.js',import.meta.url),'utf8'),ctx);
 await new Promise(r=>setImmediate(r));
 const message={type:'meto:activate',channel:'12345678-1234-1234-1234-123456789012',code:'test-private-code-for-test-only'};
 await listeners[0]({source:{},origin:'https://drricambi.it',data:message});
 await listeners[0]({source:parent,origin:'https://evil.example',data:message});
 await listeners[0]({source:parent,origin:'https://drricambi.it',data:{...message,channel:'wrong'}});
 assert.equal(authorized,false);
 await listeners[0]({source:parent,origin:'https://drricambi.it',data:message});await new Promise(r=>setImmediate(r));
 assert.equal(authorized,true);assert.equal(elements.certificateState.textContent,'Firma attiva da Odoo');
 await listeners[0]({source:parent,origin:'https://drricambi.it',data:message});
 assert.equal(calls.filter(p=>p==='/api/qz/activate').length,1);
 assert.equal(sent.some(v=>v.message.type==='meto:activated'),true);
});
