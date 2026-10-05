import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {completedDocumentCandidates} from '../lib/directfuel-completed-documents.ts';
const fixture=()=>({medicoes:[{id:'M1',numero:'MED1',status:'Aprovada',notasFiscais:[{id:'N1',numero:'0123',serie:'02',documentoPdfId:'PDF1',pdfDocumento:true,xmlDocumento:true,valorTotal:100,itensFiscais:[{id:'I1'}]}]}],sapReturns:[{measurementId:'M1',invoiceKey:'123-2',purchaseOrder:'4501',postingDate:'2026-09-01',status:'success'}],abastecimentos:[{id:'A1'}]});
test('only files are planned, all operational data is preserved verbatim',()=>{const s=fixture(),before=JSON.stringify(s);const p=completedDocumentCandidates(s);assert.equal(p.length,2);assert.ok(p.every(f=>f.eligible));assert.equal(JSON.stringify(s),before)});
test('missing order, missing posting, invalid date, errors, partial, void and unapproved all protect files',()=>{
 for(const mutate of [s=>s.sapReturns[0].purchaseOrder='',s=>s.sapReturns[0].postingDate='',s=>s.sapReturns[0].postingDate='2026-02-30',s=>s.sapReturns[0].status='error',s=>s.sapReturns[0].status='partial',s=>s.sapReturns[0].voided=true,s=>s.medicoes[0].status='Pendente',s=>s.sapReturns.push({...s.sapReturns[0],purchaseOrder:'4502',postingDate:''})]){const s=fixture();mutate(s);assert.ok(completedDocumentCandidates(s).every(f=>!f.eligible))}
});
test('shared PDF requires all invoices complete, including across measurements',()=>{
 const s=fixture();s.medicoes.push({id:'M2',status:'Aprovada',notasFiscais:[{id:'N2',numero:'124',serie:'2',documentoPdfId:'PDF1'}]});
 assert.equal(completedDocumentCandidates(s).find(f=>f.type==='pdf').eligible,false);
 s.sapReturns.push({...s.sapReturns[0],measurementId:'M2',invoiceKey:'124-2'});
 const p=completedDocumentCandidates(s);assert.equal(p.find(f=>f.type==='pdf').eligible,true);assert.equal(p.find(f=>f.type==='pdf').references.length,2);
});
test('layouts, pending references and ambiguous invoices are protected',()=>{
 const s=fixture();s.fiscalLayouts=[{reference:{documentId:'PDF1'}}];assert.equal(completedDocumentCandidates(s).find(f=>f.type==='pdf').eligible,false);
 delete s.fiscalLayouts;s.nfPendencias=[{documentoPdfId:'PDF1'}];assert.equal(completedDocumentCandidates(s).find(f=>f.type==='pdf').eligible,false);
 const x=fixture();x.medicoes[0].notasFiscais[0].documentoPdfId='NF_LAYOUT_1';assert.equal(completedDocumentCandidates(x).find(f=>f.type==='pdf').eligible,false);
 const y=fixture();y.medicoes[0].notasFiscais.push({...y.medicoes[0].notasFiscais[0],id:'N2'});assert.ok(completedDocumentCandidates(y).every(f=>!f.eligible));
});
test('D1 deletion lock blocks operational update while pending and releases afterward',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0007_perpetual_the_stranger.sql',import.meta.url),'utf8'));
 db.exec("CREATE TABLE app_state(workspace_id TEXT PRIMARY KEY,data TEXT,version INTEGER,updated_at TEXT,updated_by TEXT); INSERT INTO app_state VALUES('vixpar','{}',1,'',''); INSERT INTO document_removals VALUES('file','vixpar','pending','token','9999-01-01','now','owner',1,'tag','{}')");
 const source=readFileSync(new URL('../app/api/state/route.ts',import.meta.url),'utf8');
 const sql=source.match(/"(UPDATE app_state SET[^"\n]+)"/)[1];
 assert.equal(db.prepare(sql).run('{}',2,'now','owner','vixpar',1).changes,0);
 db.exec("UPDATE document_removals SET status='deleted'");assert.equal(db.prepare(sql).run('{}',2,'now','owner','vixpar',1).changes,1);db.close();
});
