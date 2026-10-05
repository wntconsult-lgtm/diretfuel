import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const window={};vm.runInNewContext(fs.readFileSync('public/directfuel-dashboard-financial.js','utf8'),{window,Date});const api=window.DirectFuelDashboardFinancial;
const fueling=(id,measurementId,date,extra={})=>({id,medicaoId:measurementId,data:date,unidadeId:'U',postoId:'P',produtoId:'D',centroCusto:'CC',...extra});
const state={
 abastecimentos:[fueling('A1','M1','2026-09-01'),fueling('A2','M2','2026-09-02'),fueling('A3','M3','2026-09-03'),fueling('A4','M4','2026-09-04')],
 medicoes:[
  {id:'M1',status:'Aprovada',postoId:'P',itens:['A1'],notasFiscais:[{id:'N1',numero:'000101',serie:'2',emissao:'2026-09-01',vencimento:'2026-09-17',abastecimentoIds:['A1']}]},
  {id:'M2',status:'Aprovada',postoId:'P',itens:['A2'],notasFiscais:[{id:'N2',numero:'000102',serie:'2',emissao:'2026-09-02',parcelas:[{vencimento:'2026-09-18'}],abastecimentoIds:['A2']}]},
  {id:'M3',status:'Aprovada',postoId:'P',itens:['A3'],notasFiscais:[{id:'N3',numero:'000103',serie:'2',emissao:'2026-09-03',vencimento:'2026-09-30',abastecimentoIds:['A3']}]},
  {id:'M4',status:'Aprovada',postoId:'P',itens:['A4'],notasFiscais:[{id:'N4',numero:'000104',serie:'2',emissao:'2026-09-04',abastecimentoIds:['A4']}]},
 ],
 sapReturns:[{measurementId:'M3',invoiceKey:'103-2',status:'success',purchaseOrder:'4501',postingDate:'2026-09-10'}],
};

test('financial cards reconcile posted, overdue, on-time and missing-due invoices using today',()=>{const result=api.summarize(state,{from:'2026-09-01',to:'2026-09-30',today:'2026-09-18'});assert.deepEqual({total:result.total,posted:result.posted,overdue:result.overdue,onTime:result.onTime,missingDueDate:result.missingDueDate},{total:4,posted:1,overdue:1,onTime:2,missingDueDate:1});assert.equal(result.total,result.posted+result.overdue+result.onTime);});
test('due today is on time and active dashboard dimensions use linked fuelings',()=>{const today=api.summarize(state,{from:'2026-09-02',to:'2026-09-02',today:'2026-09-18',unitId:'U',stationId:'P',productIds:['D'],costCenter:'CC'});assert.equal(today.total,1);assert.equal(today.onTime,1);assert.equal(today.overdue,0);assert.equal(api.summarize(state,{from:'2026-09-01',to:'2026-09-30',today:'2026-09-18',productIds:['ARLA']}).total,0);});
test('voided, failed or incomplete SAP relationships do not mark an invoice as posted',()=>{const copy=structuredClone(state);copy.sapReturns=[{...copy.sapReturns[0],voided:true},{measurementId:'M2',invoiceKey:'102-2',status:'error',purchaseOrder:'4502'}];const result=api.summarize(copy,{from:'2026-09-01',to:'2026-09-30',today:'2026-09-18'});assert.equal(result.posted,0);assert.equal(result.total,result.onTime+result.overdue);});
test('financial cards use the same approved-measurement basis as accounting',()=>{const copy=structuredClone(state);copy.medicoes.push({...copy.medicoes[0],id:'M5',status:'Confirmada',notasFiscais:[{...copy.medicoes[0].notasFiscais[0],id:'N5',numero:'105'}]});copy.medicoes.push({...copy.medicoes[0],id:'M6',status:'Devolvida para pendentes',notasFiscais:[{...copy.medicoes[0].notasFiscais[0],id:'N6',numero:'106'}]});const result=api.summarize(copy,{from:'2026-09-01',to:'2026-09-30',today:'2026-09-18'});assert.equal(result.total,4);assert.equal(result.total,result.posted+result.overdue+result.onTime);});

test('due bands include today and boundary exactly once and exclude posted, overdue and undated notes',()=>{
 const copy=structuredClone(state);copy.sapReturns=[];copy.config={params:{nfDueAlertDays:7}};copy.postos=[{id:'P',fantasia:'Posto teste',sap:'00123'}];
 copy.medicoes[2].notasFiscais[0].vencimento='2026-09-25';copy.medicoes[2].notasFiscais[0].valorTotal=123.45;
 let result=api.summarize(copy,{today:'2026-09-18'});
 assert.equal(result.dueSoon,2);assert.equal(result.dueLater,0);assert.equal(result.pending,result.overdue+result.dueSoon+result.dueLater+result.missingDueDate);
 assert.equal(result.entries[2].station,'Posto teste');assert.equal(result.entries[2].supplier,'00123');assert.equal(result.entries[2].value,123.45);assert.equal(result.entries[2].days,7);
 copy.config.params.nfDueAlertDays=6;result=api.summarize(copy,{today:'2026-09-18'});assert.equal(result.dueSoon,1);assert.equal(result.dueLater,1);
 copy.config.params.nfDueAlertDays=0;assert.equal(api.summarize(copy,{today:'2026-09-18'}).dueSoon,1);
 copy.config.params.nfDueAlertDays=-1;assert.equal(api.alertDays(copy),7);
});
