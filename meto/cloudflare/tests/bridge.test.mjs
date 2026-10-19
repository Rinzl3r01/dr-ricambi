import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('product messages validate origin, source, channel, payload and only apply once', async () => {
  let listener, snapshots=0;
  const values = { mainText:{value:''}, codeValue:{value:''} };
  const parent={postMessage(){}};
  const main={text:'',set(k,v){this[k]=v;}};
  const ctx={ URLSearchParams, location:{search:'?channel=12345678-1234-1234-1234-123456789012'},
    fetch:async()=>({ok:true,json:async()=>({odooOrigins:['https://odoo.example']})}),
    mainTextObject:main, canvas:{getObjects:()=>[main],requestRenderAll(){}},
    $:id=>values[id],syncHiddenMainText(){values.mainText.value=main.text;},updateMainBoxGeometry(){},
    commitHistorySnapshot(){snapshots++;},setStatus(){},
  };
  ctx.window={ parent, addEventListener(type,cb){listener=cb;} };
  vm.runInNewContext(fs.readFileSync(new URL('../public/odoo-bridge.js',import.meta.url),'utf8'),ctx);
  await new Promise(r=>setImmediate(r));
  const event={source:parent,origin:'https://odoo.example',data:{type:'meto:product',channel:'12345678-1234-1234-1234-123456789012',product:{name:'FILTRO',default_code:'DR-001',barcode:'123'}}};
  listener({...event,origin:'https://attacker.example'}); assert.equal(main.text,'');
  listener({...event,source:{}}); assert.equal(main.text,'');
  listener({...event,data:{...event.data,channel:'wrong'}}); assert.equal(main.text,'');
  listener({...event,data:{...event.data,product:{name:{html:'bad'}}}}); assert.equal(main.text,'');
  listener(event); assert.equal(main.text,'FILTRO\nDR-001'); assert.equal(values.codeValue.value,'123');
  listener(event); assert.equal(snapshots,1);
});
