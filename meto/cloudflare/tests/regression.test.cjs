const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rasterScope = {};
vm.runInNewContext(fs.readFileSync('public/zpl.js', 'utf8'), rasterScope);
const raster = rasterScope.metoRasterZpl;
function pixels(colors) { return new Uint8ClampedArray(colors.flat()); }
assert.match(raster(pixels([[0,0,0,255]]),1,1), /\^GFA,1,1,1,80/);
assert.match(raster(pixels([[255,255,255,255]]),1,1), /\^GFA,1,1,1,00/);
assert.match(raster(pixels([[0,0,0,0]]),1,1), /\^GFA,1,1,1,00/);
assert.match(raster(pixels(Array(9).fill([0,0,0,255])),9,1), /\^GFA,2,2,2,FF80/);
assert.match(raster(pixels([[179,179,179,255],[180,180,180,255]]),2,1), /\^GFA,1,1,1,80/);
assert.throws(() => raster(new Uint8Array(0),0,1));
for (const [w,h] of [[55,25],[70,30],[100,100]]) {
  const width=Math.round(w/25.4*203), height=Math.round(h/25.4*203);
  const data=new Uint8ClampedArray(width*height*4).fill(255);
  const zpl=raster(data,width,height);
  const bytes=Math.ceil(width/8)*height;
  assert.ok(zpl.includes(`^GFA,${bytes},${bytes},${Math.ceil(width/8)},`));
  assert.ok(!/\^PW|\^LL/.test(zpl));
}
const elements = new Map();
function $(id) {
  if (!elements.has(id)) elements.set(id,{value:'',disabled:false,hidden:false,listeners:{},addEventListener(e,cb){this.listeners[e]=cb;}});
  return elements.get(id);
}
let calls=[],status='', active=false, fail=false;
const ctx={ $, console, localStorage:{getItem(){return null},setItem(){}},
  URLSearchParams, location:{search:''}, setStatus(s){status=s;},
  updatePrinters(p){calls.push(['printers',p]);$('printerSelect').value=p[0]?.ip || '';},
  qz:{websocket:{isActive:()=>active,async connect(){calls.push(['connect']);if(fail)throw Error('QZ non disponibile');active=true;}},
      printers:{async find(){return ['METO'];}},configs:{create:t=>t},async print(){throw Error('Real printing must never be reached in this test');}},
};
ctx.window=ctx;
vm.runInNewContext(fs.readFileSync('public/qz-bridge.js','utf8'),ctx);
(async()=>{
  assert.equal(calls.length,0,'No automatic QZ connection');
  await $('connectQz').listeners.click();
  assert.equal(calls[0][0],'connect'); assert.equal($('printerSelect').value,'METO');
  $('connectionMode').value='network'; $('connectionMode').listeners.change();
  assert.equal($('networkLabel').hidden,false);
  $('networkHost').value='999.1.1.1';
  ctx.metoBridge.handle({type:'print'});
  await new Promise(r=>setImmediate(r));
  assert.match(status,/IPv4/); assert.equal($('printBtn').disabled,false);
  active=false; fail=true;
  await $('connectQz').listeners.click();
  assert.match(status,/QZ non disponibile/);
  console.log('PASS: raster ZPL, transparency, threshold, row padding, three formats, no auto connection, discovery, invalid IP, disconnected QZ. No printer contacted.');
})().catch(e=>{console.error(e);process.exitCode=1;});
