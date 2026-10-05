import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const source=fs.readFileSync('lib/directfuel-document-retention.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiledModule={exports:{}};vm.runInNewContext(js,{module:compiledModule,exports:compiledModule.exports,structuredClone,TextEncoder,Date,Set,Map,Math,Number,String,Boolean});
const {planDocumentRetention,retentionDays}=compiledModule.exports;
const note=(extra={})=>({id:'N1',numero:'000123',serie:'2',chave:'1'.repeat(44),emissao:'2026-01-01',valorTotal:100,itensFiscais:Array.from({length:10},(_,index)=>({descricao:`Diesel S10 aditivado item fiscal ${index}`,quantidade:10,codigoProdutoFiscal:`000${index}`})),parcelas:[{vencimento:'2026-02-01'}],errosLeitura:['Campo temporário de extração que não deve permanecer no histórico contabilizado'],pdfDocumento:true,documentoPdfId:'DOC1',abastecimentoIds:['A1'],...extra});

test('archives only approved notes posted in SAP before the retention cutoff',()=>{
 const state={config:{params:{documentRetentionDays:180}},medicoes:[{id:'M1',status:'Aprovada',notasFiscais:[note()]}],sapReturns:[{status:'success',measurementId:'M1',invoiceKey:'123-2',purchaseOrder:'4501',postingDate:'2026-01-02'}]};
 const plan=planDocumentRetention(state,new Date('2026-09-18T12:00:00Z'),'owner@test');
 assert.equal(plan.notes,1);assert.equal(plan.pdfIds.join(','),'DOC1');assert.equal(plan.state.medicoes[0].notasFiscais[0].chave,'1'.repeat(44));assert.equal(plan.state.medicoes[0].notasFiscais[0].itensFiscais,undefined);assert.equal(plan.state.medicoes[0].notasFiscais[0].documentoPdfId,undefined);assert.ok(plan.savedBytes>0);
});

test('preserves recent, unposted and shared documents',()=>{
 const shared=note({id:'N2',numero:'124',documentoPdfId:'DOC1'});
 const state={config:{params:{documentRetentionDays:180}},medicoes:[{id:'M1',status:'Aprovada',notasFiscais:[note(),shared]}],sapReturns:[{status:'success',measurementId:'M1',invoiceKey:'123-2',purchaseOrder:'4501',postingDate:'2026-01-02'}]};
 const plan=planDocumentRetention(state,new Date('2026-09-18T12:00:00Z'));
 assert.equal(plan.notes,1);assert.equal(plan.pdfIds.length,0);assert.equal(plan.state.medicoes[0].notasFiscais[0].documentoPdfRemovido,undefined);assert.equal(plan.state.medicoes[0].notasFiscais[1].itensFiscais.length,10);
});

test('each retention category can be preserved independently',()=>{
 const state={config:{params:{documentRetentionDays:180,documentRetentionPolicy:{removePdf:false,removeXml:false,compactFiscalDetails:true}}},medicoes:[{id:'M1',status:'Aprovada',notasFiscais:[note({xmlDocumento:true,xmlNome:'nota.xml'})]}],sapReturns:[{status:'success',measurementId:'M1',invoiceKey:'123-2',purchaseOrder:'4501',postingDate:'2026-01-02'}]};
 const plan=planDocumentRetention(state,new Date('2026-09-18T12:00:00Z'));
 const archived=plan.state.medicoes[0].notasFiscais[0];
 assert.equal(plan.notes,1);assert.equal(plan.pdfIds.length,0);assert.equal(plan.xmlIds.length,0);assert.equal(archived.arquivada,true);assert.equal(archived.documentoPdfId,'DOC1');assert.equal(archived.xmlDocumento,true);
});

test('unselected retention categories keep the note unchanged',()=>{
 const state={config:{params:{documentRetentionDays:180,documentRetentionPolicy:{removePdf:false,removeXml:false,compactFiscalDetails:false}}},medicoes:[{id:'M1',status:'Aprovada',notasFiscais:[note()]}],sapReturns:[{status:'success',measurementId:'M1',invoiceKey:'123-2',purchaseOrder:'4501',postingDate:'2026-01-02'}]};
 const plan=planDocumentRetention(state,new Date('2026-09-18T12:00:00Z'));
 assert.equal(plan.notes,0);assert.equal(plan.savedBytes,0);assert.equal(plan.state.medicoes[0].notasFiscais[0].itensFiscais.length,10);
});

test('retention accepts seven days and clamps smaller values',()=>{
 assert.equal(retentionDays({config:{params:{documentRetentionDays:7}}}),7);
 assert.equal(retentionDays({config:{params:{documentRetentionDays:1}}}),7);
});
