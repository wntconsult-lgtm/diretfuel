import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const window={};vm.runInNewContext(fs.readFileSync('public/directfuel-sap-return.js','utf8'),{window,Date});
const state={config:{params:{miroCategoriaNF:'Z1',miroCFOP:'1102'}},postos:[{id:'P',sap:'00123'}],sapReturns:[{measurementId:'M',invoiceKey:'3434-2',purchaseOrder:'0045001234',postingDate:'',status:'success'}]};
const invoice={m:{id:'M',status:'Aprovada',postoId:'P'},key:'3434-2',n:{numero:'003434',serie:'2',emissao:'2026-09-21',valorTotal:1234.56,chave:'3326 0918 0706 0800 0158 5500 2000 6439 6513 4641 3587'}};
test('MIRO exports one NF with linked order, Brazilian emission date, exact identifiers, note total and eight-digit code',()=>{const r=window.DirectFuelMiro.build(state,[invoice]);assert.equal(r.errors.length,0);assert.equal(r.rows[0]['Data emissão NF'],'21/09/2026');assert.equal(r.rows[0]['Número da NF'],'003434-2');assert.equal(r.rows[0]['Código numérico da chave'],'34641358');assert.equal(r.rows[0]['Pedido de compra'],'0045001234');assert.equal(r.total,1234.56);assert.equal(state.sapReturns.length,1);});
test('invalid required fields, missing or multiple orders, duplicate NF and posted invoice block export',()=>{
 const posted={...state,sapReturns:[{...state.sapReturns[0],postingDate:'2026-09-22'}]};
 const multiple={...state,sapReturns:[...state.sapReturns,{...state.sapReturns[0],purchaseOrder:'0045009999'}]};
 const cases=[
  [{...state,sapReturns:[]},[invoice]],
  [{...state,config:{}},[invoice]],
  [state,[invoice,invoice]],
  [posted,[invoice]],
  [multiple,[invoice]],
  [state,[{...invoice,n:{...invoice.n,chave:'123'}}]],
  [state,[{...invoice,n:{...invoice.n,emissao:'2026-02-30'}}]],
 ];
 for(const [s,notes] of cases)assert.ok(window.DirectFuelMiro.build(s,notes).errors.length);
});
