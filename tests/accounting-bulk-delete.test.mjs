import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(){
 const notes=Array.from({length:271},(_,i)=>({key:'NF-'+i,m:{id:'M-'+(i%14),numero:'MED-'+(i%14)}}));
 const db={sapReturns:notes.map((n,i)=>({id:'R'+i,measurementId:n.m.id,invoiceKey:n.key,requisition:'11986991',status:'success'})),medicoes:notes.map(n=>n.m),abastecimentos:[{id:'untouched'}]};
 db.sapReturns.push({...db.sapReturns[0],id:'second-line'}, {...db.sapReturns[0],id:'other-nf',invoiceKey:'OTHER'}, {...db.sapReturns[0],id:'past',voided:true});
 let commit,reason='Correção conferida',saved=0,message='';
 const back={querySelector:()=>({value:reason}),remove(){}};
 const ctx={db,route:'test',window:{DirectFuelSapReturn:{},directFuelCanAction:()=>true,DIRECTFUEL_CURRENT_EMAIL:'test@example.test'},document:{querySelector:()=>({textContent:''})},render(){},modal(title,html,callback){commit=callback;},audit(){},save(){saved++;},toast(v){message=v;},console};
 vm.createContext(ctx);
 const source=fs.readFileSync('public/directfuel-sap-return-ui.js','utf8').replace(' window.directFuelShowSapReturns=show;',' window.testDelete=deleteMarkedLinks; window.directFuelShowSapReturns=show;');
 vm.runInContext(source,ctx);
 return {ctx,db,notes,groups:()=>ctx.window.DirectFuelBulkRc.groups(db,notes),start(groups){ctx.window.testDelete(null,groups,groups.map((_,i)=>i));},confirm(){commit(back);},setReason(v){reason=v;},saved:()=>saved,message:()=>message};
}
test('271 marked NFs: removes all selected links and lines, keeps unrelated same-RC NF and history',()=>{
 const h=harness(),before=JSON.stringify([h.db.medicoes,h.db.abastecimentos]);
 const groups=h.groups();assert.equal(groups.length,271);
 h.start(groups);h.confirm();
 assert.equal(h.saved(),1);
 assert.equal(h.db.sapReturns.filter(r=>r.adjustments?.length).length,272);
 assert.ok(h.db.sapReturns.slice(0,272).every(r=>r.voided));
 assert.equal(h.db.sapReturns.find(r=>r.id==='other-nf').voided,undefined);
 assert.equal(h.db.sapReturns.find(r=>r.id==='past').adjustments,undefined);
 assert.equal(JSON.stringify([h.db.medicoes,h.db.abastecimentos]),before);
 assert.ok(h.db.sapReturns[0].adjustments[0].by==='test@example.test');
});
test('partial selection never expands to other NFs sharing the RC',()=>{
 const h=harness();h.start(h.groups().slice(0,1));h.confirm();
 assert.equal(h.db.sapReturns.filter(r=>r.adjustments?.length).length,2);
});
test('empty reason, revoked permission and changed relationships do not mutate',()=>{
 for(const mode of ['reason','permission','changed','added']){
  const h=harness();h.start(h.groups());
  if(mode==='reason')h.setReason('a');
  if(mode==='permission')h.ctx.window.directFuelCanAction=()=>false;
  if(mode==='changed')h.db.sapReturns[0].requisition='different';
  if(mode==='added')h.db.sapReturns.push({...h.db.sapReturns[0],id:'concurrent-line'});
  h.confirm();assert.equal(h.saved(),0);assert.ok(h.message());
 }
});
