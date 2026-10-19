import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function fixture(open, names = ["Meto 39"]) {
  const els=new Map(), calls=[], timers=new Map();
  let timerId=0, status='', found=[];
  function $(id) { if(!els.has(id))els.set(id,{value:'',hidden:false,disabled:false,listeners:{},addEventListener(e,cb){this.listeners[e]=cb;}});return els.get(id); }
  const ctx={ $, console,
    localStorage:{getItem(){return null;},setItem(){}},
    setStatus(v){status=v;},
    updatePrinters(v){found=v;},
    setTimeout(cb){const id=++timerId;timers.set(id,cb);return id;},
    clearTimeout(id){timers.delete(id);},
    qz:{websocket:{isActive:()=>true},socket:{async open(ip,port){calls.push(['open',ip,port]);return open(ip);},async close(ip,port){calls.push(['close',ip,port]);}},printers:{async find(){calls.push(['find']);return names;}}},
  };
  ctx.window=ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../public/qz-bridge.js',import.meta.url),'utf8'),ctx);
  return {ctx,$,calls,timers,get status(){return status;},get found(){return found;}};
}
test('network discovery probes configured hosts only, closes successes and sends no print bytes',async()=>{
  const f=fixture(ip=>ip==='10.0.0.39'?undefined:Promise.reject(new Error('offline')));
  f.$('connectionMode').value='network';f.$('connectionMode').listeners.change();
  f.$('networkHost').value='10.0.0.39';
  await f.ctx.metoBridge.handle({type:'discover'});
  assert.equal(f.calls.filter(c=>c[0]==='open').length,7);
  assert.deepEqual(f.calls.filter(c=>c[0]==='close'),[['close','10.0.0.39',9100]]);
  assert.equal(f.found.length,1);assert.equal(f.found[0].ip,'10.0.0.39');
  assert.equal(f.$('printerSelect').disabled,false);
  assert.equal(f.$('discoverBtn').disabled,false);
  assert.equal(f.calls.some(c=>c[0]==='find'),false);
});
test('system discovery uses installed printers and never probes network hosts',async()=>{
  const f=fixture(()=>{throw Error('Unexpected network probe');});
  await f.ctx.metoBridge.handle({type:'discover'});
  assert.deepEqual(f.calls,[['find']]);
  assert.equal(f.found[0].ip,'Meto 39');
});
test('a timed-out probe closes its socket if QZ grants the request late',async()=>{
  let complete;
  const f=fixture(()=>new Promise(resolve=>{complete=resolve;}));
  f.$('networkHost').value='10.0.0.39';
  const pending=f.$('testNetworkIp').listeners.click();
  await new Promise(r=>setImmediate(r));
  for(const cb of f.timers.values())cb();
  await pending;
  assert.match(f.status,/non ha confermato/);
  complete();await new Promise(r=>setImmediate(r));
  assert.equal(f.calls.filter(c=>c[0]==='close').length,1);
  assert.equal(f.$('testNetworkIp').disabled,false);
});

 test('system list keeps label queues only, deduplicates and rejects virtual branded queues',async()=>{
 const f=fixture(()=>{},['Microsoft Print to PDF','Digitus 46','ECOSYS M3550idn','OneNote','AnyDesk Printer','Zebra 30','Meto 39','ZDesigner ZD420','Warehouse ZPL','Zebra 30','Zebra PDF','metodo ufficio']);
 await f.ctx.metoBridge.handle({type:'discover'});
 assert.deepEqual(Array.from(f.found,p=>p.name),['Zebra 30','Meto 39','ZDesigner ZD420','Warehouse ZPL']);
 assert.match(f.status,/Etichettatrici/);
 });
 test('no matching queues leaves an empty list with a useful message',async()=>{
 const f=fixture(()=>{},['Microsoft Print to PDF','Kyocera']);
 await f.ctx.metoBridge.handle({type:'discover'});
 assert.equal(f.found.length,0);assert.match(f.status,/Nessuna etichettatrice/);
 });
