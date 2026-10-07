import test from 'node:test';import assert from 'node:assert/strict';import {planRetention,handleRetention} from '../supabase/functions/directfuel-api/retention.mjs';
const now=new Date('2026-10-07T14:00:00Z'),owner='owner@example.test';
const seed={config:{params:{documentRetentionDays:30}},medicoes:[{id:'m',status:'Aprovada',notasFiscais:[{id:'invoice',numero:'1',serie:'1',chave:'1'.repeat(44),valorTotal:100,quantidadeTotal:20,produtoId:'diesel',IVA:'L6',itens:[{descricao:'SYNTHETIC',payload:'x'.repeat(1000)}],pdfDocumento:true,pdfNome:'synthetic.pdf',xmlDocumento:true,xmlNome:'synthetic.xml',abastecimentoIds:['fuel']}]}],abastecimentos:[{id:'fuel',qt:20}],sapReturns:[{id:'sap',measurementId:'m',invoiceKey:'1-1',purchaseOrder:'1234567890',status:'success',postingDate:'2026-08-01'}]};
const docs=['pdf','xml'].map(type=>({id:'invoice:'+type,byte_size:100,sha256:'a'.repeat(64),object_path:'danfes/synthetic.'+type,removed_at:null}));
const plan=(state=seed,documents=docs)=>planRetention(state,documents,now,owner);
test('retention preserves totals, IVA, links, other collections and original inputs while removing only confirmed migrated attachments',()=>{
 const before=structuredClone(seed),p=plan(),n=p.state.medicoes[0].notasFiscais[0];assert.deepEqual(seed,before);assert.equal(p.notes,1);assert.equal(p.documents.length,2);assert.ok(p.savedBytes>0);assert.equal(n.itens,undefined);assert.equal(n.valorTotal,100);assert.equal(n.IVA,'L6');assert.equal(n.produtoId,'diesel');assert.deepEqual(n.abastecimentoIds,['fuel']);assert.deepEqual(p.state.abastecimentos,seed.abastecimentos);assert.deepEqual(p.state.sapReturns,seed.sapReturns);assert.equal(n.documentoPdfRemovido,true);
});
test('all active SAP matches must be successful, dated and older than the retention cutoff',()=>{
 for(const change of [{status:'partial'},{status:'error'},{purchaseOrder:''},{postingDate:'2026-02-31'},{postingDate:'2026-09-30'}]){const state=structuredClone(seed);state.sapReturns.push({...state.sapReturns[0],id:'other',...change});assert.equal(plan(state).notes,0);}
 const voided=structuredClone(seed);voided.sapReturns.push({...voided.sapReturns[0],id:'voided',status:'error',voided:true});assert.equal(plan(voided).notes,1);
 const missing=structuredClone(seed);missing.medicoes[0].notasFiscais[0].chave='invalid';assert.equal(plan(missing).notes,0);
});
test('shared attachments with newer or additional references retain their links even during compaction',()=>{
 const state=structuredClone(seed);state.medicoes.push({id:'newer',status:'Aprovada',notasFiscais:[{id:'new-invoice',numero:'2',serie:'1',chave:'2'.repeat(44),documentoPdfId:'invoice',pdfNome:'shared.pdf'}]});state.sapReturns.push({id:'new-sap',measurementId:'newer',invoiceKey:'2-1',purchaseOrder:'1234567890',status:'success',postingDate:'2026-09-30'});
 const p=plan(state),n=p.state.medicoes[0].notasFiscais[0];assert.equal(n.pdfDocumento,true);assert.equal(n.pdfNome,'synthetic.pdf');assert.equal(n.itens,undefined);assert.ok(!p.documents.some(d=>d.id==='invoice:pdf'));
 const additional={...seed,docs:[{documentId:'invoice'}]};assert.ok(!plan(additional).documents.some(d=>d.id==='invoice:pdf'));
});
test('missing documents stay referenced for migration and disabled policies and archived notes are idempotent',()=>{
 const p=plan(seed,[]),n=p.state.medicoes[0].notasFiscais[0];assert.equal(p.documents.length,0);assert.equal(p.missingDocuments,2);assert.equal(n.pdfDocumento,true);assert.equal(n.xmlDocumento,true);assert.equal(plan(p.state,[]).notes,0);
 const state=structuredClone(seed);state.config.params.documentRetentionPolicy={removePdf:false,removeXml:false,compactFiscalDetails:false};assert.equal(plan(state).notes,0);assert.deepEqual(plan(state).state,state);
});
function options(method='GET',body={}){let calls=0;return {get calls(){return calls;},args:{method,body,current:{state:seed,version:2,user:{email:owner}},documents:docs,now,limitBytes:32000000,execute:async p=>{calls++;return {version:3,documents:p.documents};},cleanup:async()=>{calls++;}}};}
test('preview is read-only and executing requires explicit confirmation and current revision',async()=>{
 const o=options();const r=await handleRetention(o.args);assert.equal(r.documents,2);assert.equal(r.version,2);assert.equal(o.calls,0);
 await assert.rejects(()=>handleRetention({...o.args,method:'POST',body:{version:2}}),e=>e.status===400);await assert.rejects(()=>handleRetention({...o.args,method:'POST',body:{version:1,confirmation:'ARQUIVAR DANFES'}}),e=>e.status===409);assert.equal(o.calls,0);
});
test('transaction failures prevent physical cleanup; cleanup failures remain resumable rather than reporting removed bytes',async()=>{
 const o=options('POST',{version:2,confirmation:'ARQUIVAR DANFES'});await assert.rejects(()=>handleRetention({...o.args,execute:async()=>{throw Object.assign(Error('Synthetic transaction conflict'),{status:409});}}),e=>e.status===409);assert.equal(o.calls,0);
 const r=await handleRetention({...o.args,cleanup:async()=>{throw Error('Synthetic storage failure');}});assert.equal(r.version,3);assert.equal(r.removedDocuments,0);assert.equal(r.cleanupPending,2);
});
test('immediate cleanup is bounded so larger executions continue through the pending-cleanup ledger',async()=>{
 const o=options('POST',{version:2,confirmation:'ARQUIVAR DANFES'});let cleaned=0;const r=await handleRetention({...o.args,execute:async()=>({version:3,documents:Array.from({length:8},(_,n)=>({id:'SYNTHETIC-'+n}))}),cleanup:async()=>{cleaned++;}});assert.equal(cleaned,3);assert.equal(r.removedDocuments,3);assert.equal(r.cleanupPending,5);
});
