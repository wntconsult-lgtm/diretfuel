import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/directfuel-ticketlog.js',import.meta.url),'utf8');
function harness({allowed=true,confirm=true,failAt=-1}={}) {
  const calls=[],messages=[];
  const state={server:{canDelete:allowed,batches:[{id:'a',kind:'fuelings',filename:'A.csv',current_records:2,current_liters:20},{id:'b',kind:'stations',filename:'B.csv'},{id:'c',kind:'fuelings',filename:'C.csv',current_records:1,current_liters:10}]}};
  const context=vm.createContext({state,confirm:()=>confirm,render:()=>{},num:String,toast:m=>messages.push(m),alert:m=>messages.push(m),loadServer:async()=>{},fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:calls.length!==failAt,json:async()=>calls.length===failAt?{error:'Falha simulada'}:{deleted:2,liters:20}};}});
  const functions=source.slice(source.indexOf('  const selectedBatches'),source.indexOf('  const state ='));
  vm.runInContext(functions+'\nglobalThis.api={selectedBatches,deleteSelectedBatches};',context);
  return {api:context.api,calls,messages,state};
}
test('bulk deletion targets selected fueling batches only, never station batches',async()=>{
  const h=harness();['a','b','c','hidden'].forEach(id=>h.api.selectedBatches.add(id));
  await h.api.deleteSelectedBatches();
  assert.deepEqual(h.calls,[{action:'delete-batch',batchId:'a'},{action:'delete-batch',batchId:'c'}]);
  assert.match(h.messages[0],/2 de 2/);assert.equal(h.state.deleting,false);
});
test('cancel and missing permission send no deletion requests',async()=>{
  for(const options of [{allowed:false},{confirm:false}]){const h=harness(options);h.api.selectedBatches.add('a');await h.api.deleteSelectedBatches();assert.equal(h.calls.length,0);}
});
test('partial failure stops deletion, reports completed count and retains failed selection',async()=>{
  const h=harness({failAt:2});['a','c'].forEach(id=>h.api.selectedBatches.add(id));await h.api.deleteSelectedBatches();
  assert.equal(h.api.selectedBatches.has('a'),false);assert.equal(h.api.selectedBatches.has('c'),true);
  assert.match(h.messages[0],/1 de 2/);assert.match(h.messages[0],/Exclusão interrompida/);assert.equal(h.state.deleting,false);
});
