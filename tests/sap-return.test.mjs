import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={};vm.runInNewContext(fs.readFileSync('public/directfuel-sap-return.js','utf8'),{window,Date});const api=window.DirectFuelSapReturn;
const state={postos:[{id:'P',sap:'6005532'}],produtos:[{id:'A',sap:'35012674'},{id:'D',sap:'35012673'}],unidades:[{id:'U',centroSap:'ZAA1'}],abastecimentos:[{id:'1',produtoId:'A',unidadeId:'U',qt:26.36,preco:3.19},{id:'2',produtoId:'D',unidadeId:'U',qt:650.03,preco:6.49}],medicoes:[{id:'M',postoId:'P',status:'Aprovada',itens:['1','2'],notasFiscais:[{numero:'9768',serie:'3',emissao:'2026-09-15'}]}]};
const row=(material,quantidade,preco,req)=>({material,quantidade,preco,centro:'ZAA1',supplier:'6005532',nf:'9768-3',date:'2026-09-15',message:`Requisição de compra criada sob nº ${req}`,requisition:req,status:'success'});
const rows=[row('35012674',26.36,3.19,'0011859062'),row('35012673',650.03,6.49,'0011859063')];
test('invoice due date uses the earliest valid invoice date and filters inclusively',()=>{
 const s=structuredClone(state),note=s.medicoes[0].notasFiscais[0];
 note.vencimento='2026-10-10';note.parcelas=[{vencimento:'2026-09-30'},{vencimento:'31/10/2026'},{vencimento:'2026-02-30'}];
 const invoice=api.invoices(s)[0];assert.equal(invoice.dueDate,'2026-09-30');
 assert.equal(api.matchesDueDate(invoice,'2026-09-30','2026-09-30'),true);
 assert.equal(api.matchesDueDate(invoice,'2026-10-01',''),false);
 assert.equal(api.matchesDueDate(invoice,'','2026-09-29'),false);
 assert.equal(api.matchesDueDate(invoice,'',''),true);
});
test('legacy single-invoice measurement supplies the due date without leaking it across multiple invoices',()=>{
 const single=structuredClone(state);single.medicoes[0].vencimento='2026-09-25';
 assert.equal(api.invoices(single)[0].dueDate,'2026-09-25');
 const multiple=structuredClone(single);multiple.medicoes[0].notasFiscais.push({numero:'9769',serie:'3',emissao:'2026-09-15'});
 assert.ok(api.invoices(multiple).every(invoice=>invoice.dueDate===''));
 assert.equal(api.matchesDueDate({dueDate:''},'2026-09-01','2026-09-30'),false);
});
test('two requisitions belong to one invoice; partial/full and repeated imports',()=>{const p=api.preview(state,rows);assert.ok(p.every(r=>!r.issue));assert.equal(p[0].requisition,'0011859062');const x=api.invoices(state)[0];assert.equal(api.status(state,x),'Sem retorno');assert.equal(api.status({...state,sapReturns:p.slice(0,1)},x),'Parcial');assert.equal(api.status({...state,sapReturns:p},x),'RC criada');assert.ok(api.preview({...state,sapReturns:p},rows).every(r=>r.issue==='Já importado'));});
test('ambiguous invoices, different amounts and duplicate requisitions are blocked',()=>{assert.match(api.preview({...state,medicoes:[...state.medicoes,{...state.medicoes[0],id:'M2'}]},rows)[0].issue,/NF ambígua/);assert.match(api.preview(state,[{...rows[0],quantidade:99}])[0].issue,/divergente/);const p=api.preview(state,rows);assert.match(api.preview({...state,sapReturns:[{...p[0],invoiceKey:'1-1'}]},rows)[0].issue,/outra NF/);});
test('header offset, blank and failure messages',()=>{const h=Array(23).fill('');h[12]='Número da NF';h[22]='Retorno';const r=Array(23).fill('');r[12]='009768-03';r[13]=new Date('2026-09-15');r[22]=rows[0].message;const p=api.parse([[],h,r],'Planilha1')[0];assert.equal(p.row,3);assert.equal(p.nf,'9768-3');assert.equal(p.requisition,'0011859062');r[22]='Erro de fornecedor';assert.equal(api.parse([h,r],'A')[0].status,'error');assert.equal(api.preview(state,[{...rows[0],message:''}])[0].issue,'Sem retorno');});
test('batch links one RC to multiple unposted invoices and rejects any prior return',()=>{
 const s=structuredClone(state);s.medicoes.push({...structuredClone(s.medicoes[0]),id:'M2',notasFiscais:[{numero:'9769',serie:'3',emissao:'2026-09-15'}]});
 const targets=[{measurementId:'M',invoiceKey:'9768-3'},{measurementId:'M2',invoiceKey:'9769-3'}];
 const rows=api.batch(s,targets,'0011859062','Conferido no SAP');assert.equal(rows.length,4);assert.ok(rows.every(r=>r.requisition==='0011859062'));
 const saved={...s,sapReturns:rows};assert.ok(api.invoices(saved).every(x=>api.status(saved,x)==='RC criada'));
 assert.throws(()=>api.batch(saved,targets,'0011859062','Conferido no SAP'),/Sem Lançamento/);
 assert.throws(()=>api.batch({...s,sapReturns:[{measurementId:'M',invoiceKey:'9768-3',status:'error'}]},targets,'0011859062','Conferido no SAP'),/Sem Lançamento/);
 const duplicate=structuredClone(s);duplicate.abastecimentos[1]={...duplicate.abastecimentos[0],id:'2'};assert.equal(new Set(api.batch(duplicate,targets.slice(0,1),'0011859062','Conferido no SAP').map(r=>r.lineKey)).size,2);
});

test('multiple different invoices in one approved measurement are individually matched',()=>{
 const s=structuredClone(state);s.medicoes[0].notasFiscais=[{numero:'639704',serie:'2',emissao:'2026-08-31',abastecimentoIds:['1']},{numero:'639725',serie:'2',emissao:'2026-08-31',abastecimentoIds:['2']}];
 const result=api.preview(s,rows.map((r,i)=>({...r,nf:i?'639725-2':'639704-2',date:'2026-08-31'})));
 assert.ok(result.every(r=>!r.issue));assert.equal(result[0].invoiceKey,'639704-2');assert.equal(result[1].invoiceKey,'639725-2');assert.ok(result.every(r=>r.measurementId==='M'));
});
test('draft copies do not create ambiguity; manual selection keeps the chosen measurement',()=>{
 const s=structuredClone(state);s.medicoes.push({...structuredClone(s.medicoes[0]),id:'DRAFT',status:'Confirmado'});
 assert.ok(api.preview(s,rows).every(r=>!r.issue));
 s.medicoes[1].status='Aprovada';
 assert.match(api.preview(s,rows)[0].issue,/NF ambígua/);
 const manual=api.preview(s,rows.map(r=>({...r,measurementId:'M'})));
 assert.ok(manual.every(r=>!r.issue&&r.measurementId==='M'));
 assert.equal(api.preview(s,[{...rows[0],measurementId:'UNKNOWN'}])[0].issue,'NF não encontrada');
});
test('import resolves duplicate invoice identities only when the linked fueling matches uniquely',()=>{
 const s=structuredClone(state);s.medicoes.push({...structuredClone(s.medicoes[0]),id:'M2',itens:['2']});s.medicoes[0].itens=['1'];
 const result=api.preview(s,rows);assert.ok(result.every(r=>!r.issue));assert.equal(result[0].measurementId,'M');assert.equal(result[1].measurementId,'M2');
});
test('removed links remain history but no longer affect status or block a new import',()=>{
 const history=api.preview(state,rows).map(r=>({...r,voided:true}));const s={...state,sapReturns:history};
 assert.equal(api.status(s,api.invoices(s)[0]),'Sem retorno');assert.ok(api.preview(s,rows).every(r=>!r.issue));
 const partial={...s,sapReturns:[{...history[0],voided:false},history[1]]};assert.equal(api.status(partial,api.invoices(partial)[0]),'Parcial');
});

test('purchase report maps supplier plus invoice number without the DirectFuel series and consolidates repeated rows',()=>{
 const headers=['Data de Criação da Requisição','Status Item Material Requisição','Documento de Compras','Data de Criação do Pedido','Fornecedor do Pedido','Status do Pedido','Documento do Item de Saída NFT /Entrada','Nº da Nota Fiscal','Data do Lançamento da Nota Fiscal'];
 const data=[new Date('2026-08-06'),'Concluído','4502936107',new Date('2026-08-07'),'6005532','Pendente','','000009768',new Date('2026-08-07')];
 const parsed=api.parse([headers,data,data],'Sheet1');
 assert.equal(parsed.length,1);assert.equal(JSON.stringify(parsed[0].sourceRows),'[2,3]');assert.equal(parsed[0].invoiceNumber,'9768');assert.equal(parsed[0].postingDate,'2026-08-07');
 const result=api.purchasePreview(state,parsed);assert.equal(result[0].issue,'');assert.equal(result[0].invoiceKey,'9768-3');assert.equal(result[0].measurementId,'M');
 const saved={...state,sapReturns:result};assert.equal(api.postingStatus(saved,api.invoices(saved)[0]),'Lançada no SAP');
 assert.equal(api.purchasePreview(saved,parsed)[0].issue,'Já importado');
});

test('purchase report blocks ambiguous base invoice numbers when SAP omits the series',()=>{
 const s=structuredClone(state);s.medicoes.push({...structuredClone(s.medicoes[0]),id:'M2',notasFiscais:[{numero:'9768',serie:'4',emissao:'2026-09-16'}]});
 const rows=[{source:'sap-purchase-report',status:'success',purchaseOrder:'4502936107',supplier:'6005532',invoiceNumber:'9768',postingDate:'2026-09-17'}];
 assert.match(api.purchasePreview(s,rows)[0].issue,/não informa a série/);
});

test('five-column SAP layout maps numeric identifiers and distinguishes creation from posting date',()=>{
 const headers=['Documento de Compras','Data de Criação do Pedido','Fornecedor do Pedido','Nº da Nota Fiscal','Data do Lançamento da Nota Fiscal'];
 const line=[4502936107,new Date('2026-08-07'),6005532,9768,new Date('2026-09-17')];
 const parsed=api.parse([headers,line,line],'Sheet1');
 assert.equal(parsed.length,1);assert.equal(parsed[0].purchaseOrder,'4502936107');
 assert.equal(parsed[0].purchaseOrderDate,'2026-08-07');assert.equal(parsed[0].postingDate,'2026-09-17');
 const result=api.purchasePreview(state,parsed);assert.equal(result[0].issue,'');assert.equal(result[0].invoiceKey,'9768-3');
 const other=structuredClone(state);other.postos[0].sap='9999999';assert.match(api.purchasePreview(other,parsed)[0].issue,/não encontrada/);
 const saved={...state,sapReturns:result};assert.equal(api.purchasePreview(saved,parsed)[0].issue,'Já importado');
 saved.sapReturns=result.map(row=>({...row,voided:true}));assert.equal(api.purchasePreview(saved,parsed)[0].issue,'');
});

test('blank posting date links the order before MIRO; invalid dates never mark the invoice as posted',()=>{
 const headers=['Documento de Compras','Data de Criação do Pedido','Fornecedor do Pedido','Nº da Nota Fiscal','Data do Lançamento\n da Nota Fiscal'];
 const pending=api.parse([headers,[4502936107,'07/08/2026',6005532,9768,'']],'Sheet1');
 assert.equal(pending[0].status,'success');const pendingPreview=api.purchasePreview(state,pending);assert.equal(pendingPreview[0].issue,'');
 assert.equal(api.postingStatus({...state,sapReturns:pendingPreview},api.invoices(state)[0]),'Pedido vinculado — aguardando MIRO');
 for(const date of ['31/02/2026', '2026-13-01']){
  const parsed=api.parse([headers,[4502936107,'07/08/2026',6005532,9768,date]],'Sheet1');
  assert.equal(parsed[0].status,'error');assert.ok(api.purchasePreview(state,parsed)[0].issue);
 }
 const parsed=api.parse([headers,[4502936107,'07/08/2026',6005532,9768,'17/09/2026']],'Sheet1');
 assert.equal(parsed[0].postingDate,'2026-09-17');assert.equal(api.purchasePreview(state,parsed)[0].issue,'');
});
test('an invoice already posted in SAP cannot be imported again as awaiting MIRO',()=>{
 const posted={source:'sap-purchase-report',status:'success',purchaseOrder:'4502936107',supplier:'6005532',invoiceNumber:'9768',postingDate:'2026-08-07',measurementId:'M',invoiceKey:'9768-3'};
 const saved={...state,sapReturns:[posted]};
 const pending={...posted,postingDate:'',measurementId:'',invoiceKey:''};
 const result=api.purchasePreview(saved,[pending])[0];
 assert.equal(result.issue,'NF já lançada no SAP em 07/08/2026; nova carga bloqueada');
 assert.match(api.purchaseOutcome(result),/^Bloqueado/);
 const changedDate=api.purchasePreview(saved,[{...pending,postingDate:'2026-08-08'}])[0];
 assert.match(changedDate.issue,/já lançada no SAP em 07\/08\/2026/);
 assert.equal(api.purchasePreview(saved,[{...pending,postingDate:'2026-08-07'}])[0].issue,'Já importado');
});
test('preview outcome never labels a row without NF as awaiting MIRO',()=>{
 const missing={source:'sap-purchase-report',status:'error',purchaseOrder:'4502970945',supplier:'6022586',invoiceNumber:'',postingDate:''};
 const result=api.purchasePreview(state,[missing])[0];assert.match(result.issue,/Pedido, fornecedor ou NF ausente/);
 assert.match(api.purchaseOutcome(result),/^Bloqueado/);assert.doesNotMatch(api.purchaseOutcome(result),/aguardando MIRO/);
});

test('manual purchase uses exact invoice and preserves zeroes, posted status and history fields',()=>{
 const record=api.manualPurchase(state,{measurementId:'M',invoiceKey:'9768-3'},'000450123','2026-09-21','Conferido no SAP',true);
 assert.equal(record.purchaseOrder,'000450123');assert.equal(record.source,'manual-purchase');assert.equal(record.supplier,'6005532');assert.equal(record.invoiceKey,'9768-3');
 const saved={...state,sapReturns:[record]};assert.equal(api.postingStatus(saved,api.invoices(saved)[0]),'Lançada no SAP');
 assert.throws(()=>api.manualPurchase(saved,{measurementId:'M',invoiceKey:'9768-3'},'450999','2026-09-22','Conferido no SAP',true),/já possui/);
 const ambiguous=structuredClone(state);ambiguous.medicoes[0].notasFiscais.push({...ambiguous.medicoes[0].notasFiscais[0],serie:'4'});
 assert.equal(api.manualPurchase(ambiguous,{measurementId:'M',invoiceKey:'9768-4'},'450123','2026-09-21','Conferido no SAP',true).invoiceKey,'9768-4');
});
test('manual order can be linked before MIRO and completed later with the posting date',()=>{
 const pending=api.manualPurchase(state,{measurementId:'M',invoiceKey:'9768-3'},'000450123','','Pedido conferido',true);
 const waiting={...state,sapReturns:[pending]};assert.equal(api.postingStatus(waiting,api.invoices(waiting)[0]),'Pedido vinculado — aguardando MIRO');
 const posted=api.manualPurchase(waiting,{measurementId:'M',invoiceKey:'9768-3'},'000450123','2026-09-22','MIRO concluída',true);
 assert.equal(api.postingStatus({...waiting,sapReturns:[pending,posted]},api.invoices(waiting)[0]),'Lançada no SAP');
 assert.throws(()=>api.manualPurchase(waiting,{measurementId:'M',invoiceKey:'9768-3'},'999','','Pedido diferente',true),/já está vinculada/);
});
test('manual purchase rejects invalid inputs and nonapproved invoice',()=>{
 const target={measurementId:'M',invoiceKey:'9768-3'};
 for(const args of [['abc','2026-09-21','Conferido',true],['4501','2026-02-30','Conferido',true],['4501','2026-09-21','',true],['4501','2026-09-21','Conferido',false]])assert.throws(()=>api.manualPurchase(state,target,...args));
 const copy=structuredClone(state);copy.medicoes[0].status='Pendente';assert.throws(()=>api.manualPurchase(copy,target,'4501','2026-09-21','Conferido',true),/aprovada/);
});
