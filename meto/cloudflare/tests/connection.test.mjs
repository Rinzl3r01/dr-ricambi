import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function setup(health, websocket) {
  const elements=new Map(),timers=new Map(),calls=[];
  let tid=0,active=false,status='';
  function $(id){if(!elements.has(id))elements.set(id,{value:'',listeners:{},addEventListener(e,cb){this.listeners[e]=cb;}});return elements.get(id);}
  const c={ $,console,localStorage:{getItem(){return null;},setItem(){}},setStatus(v){status=v;},updatePrinters(){},
    setTimeout(cb){const id=++tid;timers.set(id,cb);return id;},clearTimeout(id){timers.delete(id);},
    fetch(url,options){calls.push(['health',url,options]);return health();},
    qz:{websocket:{isActive:()=>active,connect(){active=true;calls.push(['connect']);return websocket();},async disconnect(){active=false;calls.push(['disconnect']);}}},
  };
  c.window=c;
  vm.runInNewContext(fs.readFileSync(new URL('../public/qz-bridge.js',import.meta.url),'utf8'),c);
  return {$,calls,timers,get status(){return status;}};
}
test('HTTPS permission probe sends no cookies and connection waits for it',async()=>{
  const f=setup(async()=>({opaque:true}),async()=>{});
  await f.$('connectQz').listeners.click();
  assert.equal(f.calls[0][0],'health');assert.equal(f.calls[0][2].credentials,'omit');
  assert.equal(f.calls[0][2].mode,'no-cors');assert.equal(f.calls[1][0],'connect');
  assert.equal(f.timers.size,0);
});
test('parallel actions share one pending connection even when QZ isActive includes connecting',async()=>{
  let complete;
  const f=setup(async()=>({}),()=>new Promise(r=>{complete=r;}));
  const a=f.$('connectQz').listeners.click();
  await new Promise(r=>setImmediate(r));
  const b=f.$('connectQz').listeners.click();
  complete();await Promise.all([a,b]);
  assert.equal(f.calls.filter(c=>c[0]==='connect').length,1);
});
test('a late health response cannot start QZ after the connection deadline',async()=>{
  let complete;
  const f=setup(()=>new Promise(r=>{complete=r;}),async()=>{});
  const pending=f.$('connectQz').listeners.click();
  for(const cb of f.timers.values())cb();
  await pending;
  complete();await new Promise(r=>setImmediate(r));
  assert.equal(f.calls.some(c=>c[0]==='connect'),false);
  assert.match(f.status,/scaduta/);assert.equal(f.$('connectQz').disabled,false);
});
