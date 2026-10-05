import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('public/directfuel-enterprise.js','utf8');
const start=source.indexOf('  function buildDueCorrection('),end=source.indexOf('  function correctMeasurementDueDates(',start);
const build=vm.runInNewContext(source.slice(start,end)+';buildDueCorrection',{structuredClone,Date});
const measurement={id:'M7',numero:'MED-2026-0007',status:'Aprovada',aprovadoPor:'Owner',accountingAdjustmentId:'A1',itens:['F1'],valorNf:300,vencimento:'2026-09-01',notasFiscais:[{numero:'1',valorTotal:100,vencimento:'2026-09-01',parcelas:[{numero:'1',valor:100,vencimento:'2026-09-01'}]},{numero:'2',valorTotal:200,vencimento:'2026-10-10'}]};
test('correction updates only selected invoice and parcels, preserves approval and SAP link',()=>{
 const old=JSON.stringify(measurement);const {updated,detail}=build(measurement,[{index:0,due:'2026-10-01',parcels:['2026-10-02']}],'Erro de digitação');
 assert.equal(updated.vencimento,'2026-10-01');assert.equal(updated.status,'Aprovada');assert.equal(updated.accountingAdjustmentId,'A1');assert.equal(updated.valorNf,300);assert.deepEqual(updated.itens,['F1']);assert.deepEqual(updated.notasFiscais[1],measurement.notasFiscais[1]);assert.equal(updated.notasFiscais[0].parcelas[0].valor,100);assert.match(detail,/2026-09-01 → 2026-10-01/);assert.match(detail,/parcela 1/);assert.match(detail,/Erro de digitação/);assert.equal(JSON.stringify(measurement),old);
});
test('rejects invalid dates, absent selection/reason and no-op without mutating original',()=>{
 for(const [changes,reason] of [[[],'Ajustar data'],[[{index:0,due:'2026-02-30',parcels:['2026-10-01']}],'Ajustar data'],[[{index:0,due:'2026-10-01',parcels:['2026-10-01']}],''],[[{index:0,due:'2026-09-01',parcels:['2026-09-01']}],'Ajustar data']])assert.throws(()=>build(measurement,changes,reason));
 assert.equal(measurement.vencimento,'2026-09-01');
});
test('legacy invoice retains identity and amount',()=>{const result=build({id:'M',nf:'12',valorNf:10,vencimento:'2026-01-01'},[{index:0,due:'2026-10-10',parcels:[]}],'Data corrigida');assert.equal(result.updated.nf,'12');assert.equal(result.updated.valorNf,10);assert.equal(result.updated.vencimento,'2026-10-10');});
