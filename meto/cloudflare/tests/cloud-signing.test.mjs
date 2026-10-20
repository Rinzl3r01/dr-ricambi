import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,createHash} from 'node:crypto';
import {signingRoute,validateMessage} from '../signing.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const env={QZ_PRIVATE_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'}),QZ_ENROLLMENT_CODE:'a-private-activation-code',QZ_SESSION_KEY:'a-private-session-key',QZ_LOGIN_LIMITER:{async limit(){return {success:true};}},QZ_SIGN_LIMITER:{async limit(){return {success:true};}}};
const req=(path,data,cookie,origin='https://meto.example')=>new Request('https://meto.example/api/qz/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
const raw=(call,params)=>JSON.stringify({call,params,timestamp:Date.now()});
async function activate(){const result=await signingRoute(req('activate',{code:env.QZ_ENROLLMENT_CODE}),env);assert.equal(result.status,200);return result.headers.get('Set-Cookie').split(';')[0];}
test('Cloudflare signing rejects anonymous users, wrong codes and foreign origins',async()=>{
 assert.equal((await signingRoute(req('sign',{message:raw('printers.find',{})}),env)).status,401);
 assert.equal((await signingRoute(req('activate',{code:'wrong'}),env)).status,401);
 assert.equal((await signingRoute(req('activate',{code:env.QZ_ENROLLMENT_CODE},null,'https://evil.example'),env)).status,403);
 assert.equal((await signingRoute(req('status'),{})).status,503);
});
test('activation uses an HttpOnly partitioned cookie and signatures verify cryptographically',async()=>{
 const response=await signingRoute(req('activate',{code:env.QZ_ENROLLMENT_CODE}),env);
 const header=response.headers.get('Set-Cookie');assert.match(header,/HttpOnly/);assert.match(header,/Secure/);assert.match(header,/Partitioned/);assert.match(header,/SameSite=None/);
 const cookie=header.split(';')[0];
 assert.equal((await (await signingRoute(req('status',undefined,cookie),env)).json()).authorized,true);
 const message=raw('printers.find',{});
 const signed=await signingRoute(req('sign',{message},cookie),env);assert.equal(signed.status,200);
 const {signature}=await signed.json();const digest=createHash('sha256').update(message).digest('hex');
 assert.equal(verify('RSA-SHA512',Buffer.from(digest),pair.publicKey,Buffer.from(signature,'base64')),true);
 const tampered=cookie.slice(0,-3)+'abc';assert.equal((await signingRoute(req('sign',{message},tampered),env)).status,401);
});
test('policy allows only configured printers and exact raster, rejects stale requests and extra commands',async()=>{
 const cookie=await activate();
 for(const [call,params] of [['file.write',{}],['socket.sendData',{}],['socket.open',{host:'8.8.8.8',port:9100}],['socket.open',{host:'10.0.0.39',port:22}]])assert.equal((await signingRoute(req('sign',{message:raw(call,params)},cookie),env)).status,400);
 const zpl='^XA\n^FO0,0\n^GFA,11000,11000,55,'+'00'.repeat(11000)+'\n^FS\n^XZ\n';
 const params={printer:{host:'10.0.0.39',port:9100},options:{copies:1},data:[{type:'raw',format:'command',flavor:'plain',data:zpl}]};
 validateMessage(raw('print',params));
 params.data[0].data+='~JA';assert.throws(()=>validateMessage(raw('print',params)));
 assert.throws(()=>validateMessage(raw('printers.find',{}),undefined,Date.now()+90000));
});
test('login and signing rate limits fail closed',async()=>{
 const no={async limit(){return {success:false};}};
 assert.equal((await signingRoute(req('activate',{code:env.QZ_ENROLLMENT_CODE}),{...env,QZ_LOGIN_LIMITER:no})).status,429);
 const cookie=await activate();assert.equal((await signingRoute(req('sign',{message:raw('printers.find',{})},cookie),{...env,QZ_SIGN_LIMITER:no})).status,429);
});
