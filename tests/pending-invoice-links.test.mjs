import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/directfuel-invoices.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('    function availableForMeasurement('),source.indexOf('    function adjustFuelingLinks('));
test('picker permits pending fuelings at the same station and rejects other measurement ownership',()=>{
 const db={medicoes:[{id:'other',itens:['claimed'],status:'Aguardando NF'},{id:'returned',itens:['released'],status:'Devolvida para pendentes'}]};
 const context=vm.createContext({db,measurement:{id:'current',postoId:'roma'},records:x=>Array.isArray(x)?x:[]});
 vm.runInContext(code,context);
 for(const [item,expected] of [[{id:'pending',postoId:'roma'},true],[{id:'own',postoId:'roma',medicaoId:'current'},true],[{id:'other',postoId:'roma',medicaoId:'other'},false],[{id:'claimed',postoId:'roma'},false],[{id:'released',postoId:'roma'},true],[{id:'station',postoId:'elsewhere'},false]])assert.equal(context.availableForMeasurement(item),expected);
 db.medicoes.push({id:'new',itens:['pending']});
 assert.equal(context.availableForMeasurement({id:'pending',postoId:'roma'}),false);
});
test('transfer requires confirmation and removes old ownership before assigning the new NF',()=>{
 const start=source.indexOf('        const transfers=');
 const end=source.indexOf('        for(const item of added)',start);
 const code=source.slice(start,end);
 for(const approved of [false,true]){
  const other={numero:'640565',abastecimentoIds:['target','keep'],conferenciaConfirmada:true};
  const note={numero:'640566',abastecimentoIds:[]};
  const context=vm.createContext({measurement:{notasFiscais:[other,note]},note,chosen:['target'],records:x=>Array.isArray(x)?x:[],confirm:()=>approved,resetNoteConference:n=>n.conferenciaConfirmada=false,addHistory:()=>{}});
  vm.runInContext('(function(){'+code+'})()',context);
  assert.equal(other.abastecimentoIds.includes('target'),!approved);
  assert.equal(other.abastecimentoIds.includes('keep'),true);
  assert.equal(other.conferenciaConfirmada,!approved);
  if(approved)assert.equal(other.vinculoManual,true);
 }
});
