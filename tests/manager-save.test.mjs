import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const transpile = name => ts.transpileModule(readFileSync(new URL('../lib/'+name+'.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url = js => 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const {authorizeChanges,analyzeChanges,validateBusinessRules} = await import(url(transpile('directfuel-security').replace('"./directfuel-invoices"', JSON.stringify(url(transpile('directfuel-invoices'))))));
const access = {isOwner:false,user:{email:'gestor@example.test'},directFuelUser:{perfil:'Gestor',acoes:['medicoes:incluir','medicoes:editar','acordos:incluir','acordos:editar']}};
const base = {users:[{id:'owner',perfil:'Master'},{id:'manager',perfil:'Gestor'}],medicoes:[],acordos:[]};
const check = (before,after,actor=access) => authorizeChanges(actor,before,after,analyzeChanges(before,after));
test('manager can create and edit measurements and agreements with owner Master in shared state',()=>{
  for(const collection of ['medicoes','acordos']){
    const created={...base,[collection]:[{id:'record',status:'Pendente'}]};
    assert.equal(check(base,created),null);
    assert.equal(check(created,{...created,[collection]:[{...created[collection][0],observacao:'Atualizada'}]}),null);
  }
});
test('manager cannot change users, assign Master or change configuration',()=>{
  for(const next of [{...base,users:base.users.map(u=>u.id==='manager'?{...u,perfil:'Master'}:u)},{...base,users:[base.users[1]]},{...base,config:{alterado:true}}]) assert.match(check(base,next),/Somente o proprietário/);
});
test('missing action permissions still deny saving',()=>{
  assert.match(check(base,{...base,medicoes:[{id:'new'}]},{...access,directFuelUser:{perfil:'Gestor',acoes:[]}}),/não permite incluir/);
});
test('approval and confirmed measurement protections remain enforced',()=>{
  assert.match(check(base,{...base,medicoes:[{id:'new',status:'Aprovada'}]}),/não permite aprovar/);
  const previous={...base,medicoes:[{id:'confirmed',status:'Confirmado'}]};
  assert.equal(check(previous,{...previous,medicoes:[{...previous.medicoes[0],observacao:'Alterada'}]}),null);
});

const admin = {...access,directFuelUser:{perfil:'Administrador',acoes:['*']}};
test('administrator with grants edits confirmed measurements and approves them',()=>{
 const before={...base,medicoes:[{id:'m',status:'Confirmado',nf:'123'}]};
 assert.equal(check(before,{...before,medicoes:[{...before.medicoes[0],nf:'456'}]},admin),null);
 assert.equal(check(before,{...before,medicoes:[{...before.medicoes[0],status:'Aprovada'}]},admin),null);
 const noApproval={...admin,directFuelUser:{perfil:'Administrador',acoes:['medicoes:editar']}};
 assert.match(check(before,{...before,medicoes:[{...before.medicoes[0],status:'Aprovada'}]},noApproval),/não permite aprovar/);
 const noEdit={...admin,directFuelUser:{perfil:'Administrador',acoes:[]}};
 assert.match(check(before,{...before,medicoes:[{...before.medicoes[0],nf:'456'}]},noEdit),/não permite editar/);
});
test('RC export records history without granting permission to alter fiscal data',()=>{
 const before={...base,medicoes:[{id:'m',status:'Aprovada',nf:'123',historico:[{acao:'Medição aprovada'}]}]};
 const measurement={...before.medicoes[0],rcSapGeradoEm:'2026-09-15',rcSapGeradoPor:'user',historico:[{acao:'RC SAP gerada'},...before.medicoes[0].historico]};
 const exporter={...access,directFuelUser:{perfil:'Gestor',acoes:['medicoes:exportar']}};
 assert.equal(check(before,{...before,medicoes:[measurement]},exporter),null);
 assert.match(check(before,{...before,medicoes:[{...measurement,nf:'999'}]},exporter),/não permite editar/);
 assert.match(check(before,{...before,medicoes:[measurement]},access),/não permite exportar/);
 const rewrite={...measurement,historico:[{acao:'RC SAP gerada'},{acao:'Apagada'}]};
 assert.match(check(before,{...before,medicoes:[rewrite]},exporter),/não permite editar/);
});
test('administrator remains unable to change owner-only user and configuration controls',()=>{
 assert.match(check(base,{...base,config:{changed:true}},admin),/Somente o proprietário/);
});

test('explicit grants are authoritative regardless of profile label',()=>{
 const before={...base,medicoes:[{id:'m',status:'Confirmado'}],abastecimentos:[{id:'fuel'}]};
 for(const perfil of ['Administrador','Gestor','Consulta']) {
  const granted={...access,directFuelUser:{perfil,acoes:['medicoes:editar','medicoes:aprovar','abastecimentos:excluir']}};
  assert.equal(check(before,{...before,medicoes:[{id:'m',status:'Aprovada'}]},granted),null);
  assert.equal(check(before,{...before,abastecimentos:[]},granted),null);
  const denied={...access,directFuelUser:{perfil,acoes:[]}};
  assert.match(check(before,{...before,abastecimentos:[]},denied),/não permite excluir/);
 }
});
test('reopening preserves linked invoices and fuelings and requires administrator deletion grant',()=>{
 const before={...base,medicoes:[{id:'m',status:'Aprovada',itens:['fuel'],notasFiscais:[{numero:'123'}]}],abastecimentos:[{id:'fuel',medicaoId:'m'}]};
 const after=structuredClone(before);Object.assign(after.medicoes[0],{status:'Pendente de aprovação',reaberturaMotivo:'Correção solicitada'});
 const actor={...access,directFuelUser:{perfil:'Administrador',acoes:['medicoes:excluir']}};
 assert.equal(check(before,after,actor),null);
 assert.deepEqual(after.medicoes[0].notasFiscais,before.medicoes[0].notasFiscais);
 assert.deepEqual(after.abastecimentos,before.abastecimentos);
 assert.match(check(before,after,{...actor,directFuelUser:{perfil:'Administrador',acoes:['medicoes:editar']}}),/permissão de excluir/);
 const linked=structuredClone(before);linked.medicoes[0].accountingAdjustmentId='accounting';const linkedNext=structuredClone(after);linkedNext.medicoes[0].accountingAdjustmentId='accounting';
 assert.match(check(linked,linkedNext,actor),/contabilização/);
 const changed=structuredClone(after);changed.medicoes[0].itens=[];assert.notEqual(check(before,changed,actor),null);
});
test('SAP relationship edits and removals have separate grants and immutable history',()=>{
 const record={id:'R1',measurementId:'M1',invoiceKey:'1-1',requisition:'00123',status:'success',message:'Original SAP message'};
 const previous={...base,sapReturns:[record]};
 const event={action:'edit',from:'00123',to:'00456',reason:'Correção conferida',at:'2026-09-16T10:00:00Z',by:'gestor@example.test'};
 const edited={...previous,sapReturns:[{...record,requisition:'00456',adjustments:[event]}]};
 assert.equal(check(previous,edited),null);
 const deleteOnly={...access,directFuelUser:{perfil:'Gestor',acoes:['medicoes:excluir']}};
 assert.match(check(previous,edited,deleteOnly),/não permite/);
 const removed={...previous,sapReturns:[{...record,voided:true,adjustments:[{...event,action:'delete',to:''}]}]};
 assert.equal(check(previous,removed,deleteOnly),null);
 assert.match(check(previous,removed),/não permite/);
 assert.match(check(previous,{...edited,sapReturns:[{...edited.sapReturns[0],message:'Changed'}]}),/originais/);
 assert.match(check(previous,{...edited,sapReturns:[{...edited.sapReturns[0],adjustments:[]}]}),/histórico/);
 assert.match(check(previous,{...previous,sapReturns:[]},deleteOnly),/histórico/);
});
test('multiple marked SAP relationships can be removed in one audited save',()=>{
 const records=[
  {id:'R1',measurementId:'M1',invoiceKey:'1-1',requisition:'00123',status:'success',message:'Original SAP message'},
  {id:'R2',measurementId:'M1',invoiceKey:'1-1',requisition:'00456',status:'success',message:'Original SAP message'},
 ];
 const previous={...base,sapReturns:records},at='2026-09-16T12:00:00Z',by='gestor@example.test',reason='Relacionamentos conferidos no SAP';
 const removed={...previous,sapReturns:records.map(record=>({...record,voided:true,adjustments:[{action:'delete',from:record.requisition,to:'',reason,at,by}]}))};
 const deleteOnly={...access,directFuelUser:{perfil:'Gestor',acoes:['medicoes:excluir']}};
 assert.equal(check(previous,removed,deleteOnly),null);
});
test('SAP purchase report relationship validates supplier, base invoice number, purchase order and posting date',()=>{
 const previous={...base,postos:[{id:'P',sap:'6005532'}],medicoes:[{id:'M',postoId:'P',status:'Aprovada',notasFiscais:[{numero:'9768',serie:'3',emissao:'2026-09-15'}]}],sapReturns:[]};
 const record={id:'SAPPOST-1',measurementId:'M',invoiceKey:'9768-3',invoiceNumber:'9768',supplier:'6005532',purchaseOrder:'4502936107',postingDate:'2026-09-17',status:'success',source:'sap-purchase-report',message:'Pedido de compra 4502936107 · lançamento 2026-09-17',filename:'LAYOUT SAP.xlsx',sheet:'Sheet1',row:2,sourceRows:[2,3],importedAt:'2026-09-17T00:00:00Z',importedBy:'gestor@example.test'};
 assert.equal(check(previous,{...previous,sapReturns:[record]}),null);
 assert.match(check(previous,{...previous,sapReturns:[{...record,invoiceNumber:'9768-3'}]}),/número da NF/);
 const saved={...previous,sapReturns:[record]},event={action:'delete',from:'4502936107',to:'',reason:'Importação incorreta',at:'2026-09-17T01:00:00Z',by:'gestor@example.test'};
 const removed={...saved,sapReturns:[{...record,voided:true,adjustments:[event]}]};
 const deleteOnly={...access,directFuelUser:{perfil:'Gestor',acoes:['medicoes:excluir']}};
 assert.equal(check(saved,removed,deleteOnly),null);
});
test('SAP purchase report accepts an order before MIRO and a later posting date for the same order',()=>{
 const previous={...base,postos:[{id:'P',sap:'6005532'}],medicoes:[{id:'M',postoId:'P',status:'Aprovada',notasFiscais:[{numero:'9768',serie:'3',emissao:'2026-09-15'}]}],sapReturns:[]};
 const pending={id:'SAPORDER-1',measurementId:'M',invoiceKey:'9768-3',invoiceNumber:'9768',supplier:'6005532',purchaseOrder:'4502936107',postingDate:'',status:'success',source:'sap-purchase-report',message:'Pedido de compra 4502936107 · aguardando MIRO',filename:'RELATORIO SAP.xlsx',sheet:'Sheet1',row:2,sourceRows:[2],importedAt:'2026-09-17T00:00:00Z',importedBy:'gestor@example.test'};
 const waiting={...previous,sapReturns:[pending]};assert.equal(check(previous,waiting),null);
 const posted={...pending,id:'SAPPOST-2',postingDate:'2026-09-22',message:'Pedido de compra 4502936107 · lançamento 2026-09-22',row:3,sourceRows:[3]};
 assert.equal(check(waiting,{...waiting,sapReturns:[pending,posted]}),null);
 assert.match(check(waiting,{...waiting,sapReturns:[pending,{...posted,purchaseOrder:'4509999999'}]}),/já possui pedido/);
});
test('a rejected measurement can be corrected by returning its fuelings to pending',()=>{
 const previous={...base,medicoes:[{id:'m',numero:'MED-2026-0022',status:'Rejeitada',itens:['fuel'],historico:[{acao:'Medição rejeitada'}],rejeitadaPor:'user',rejeitadaEm:'2026-09-16T16:35:08Z',rejeicaoMotivo:'Faltou abastecimento'}],abastecimentos:[{id:'fuel',medicaoId:'m',priceValidationOverride:true,priceOverrideJustification:'Registro histórico validado'}]};
 const next=structuredClone(previous),measurement=next.medicoes[0];
 Object.assign(measurement,{status:'Devolvida para pendentes',itens:[],itensDevolvidos:['fuel'],devolvidaPor:'owner',devolvidaEm:'2026-09-16T20:00:00Z',devolucaoMotivo:'Correção da rejeição anterior',historico:[{acao:'Medição devolvida para pendentes'},...measurement.historico]});
 delete measurement.rejeitadaPor;delete measurement.rejeitadaEm;delete measurement.rejeicaoMotivo;next.abastecimentos[0].medicaoId=null;
 assert.equal(validateBusinessRules(previous,next),null);
 assert.equal(check(previous,next,admin),null);
});

test('due-only correction preserves approval despite historical price issues; price changes still fail',()=>{
 const before={medicoes:[{id:'M',postoId:'P',status:'Aprovada',itens:['F'],vencimento:'2026-09-01',notasFiscais:[{numero:'1',chave:'1'.repeat(44),arquivada:true,quantidadeTotal:1,valorTotal:10,vencimento:'2026-09-01',parcelas:[{valor:10,vencimento:'2026-09-01'}]}]}],abastecimentos:[{id:'F',medicaoId:'M',data:'2026-09-01',postoId:'P',produtoId:'D',qt:1,preco:10,total:10}],acordos:[]};
 const next=structuredClone(before);next.medicoes[0].vencimento='2026-10-01';next.medicoes[0].notasFiscais[0].vencimento='2026-10-01';next.medicoes[0].notasFiscais[0].parcelas[0].vencimento='2026-10-01';next.medicoes[0].historico=[{acao:'Vencimento corrigido',detalhe:'Erro de digitação'}];
 assert.equal(validateBusinessRules(before,next),null);assert.equal(check(before,next),null);
 assert.match(check(before,next,{...access,directFuelUser:{perfil:'Gestor',acoes:[]}}),/não permite editar/);
 next.medicoes[0].notasFiscais[0].valorTotal=20;assert.match(validateBusinessRules(before,next),/tolerância|pendência de acordo ou preço/);
});

test('manual purchase uses existing inclusion permission and enforces confirmation and duplicate protection',()=>{
 const previous={...base,postos:[{id:'P',sap:'6005532'}],medicoes:[{id:'M',postoId:'P',status:'Aprovada',notasFiscais:[{numero:'9768',serie:'3',emissao:'2026-09-15'}]}],sapReturns:[]};
 const record={id:'MAN1',measurementId:'M',invoiceKey:'9768-3',invoiceNumber:'9768',supplier:'6005532',purchaseOrder:'4501',postingDate:'2026-09-21',status:'success',source:'manual-purchase',reason:'Conferido no SAP',confirmed:true,message:'Vínculo manual',filename:'Vínculo manual',sourceRows:[1],importedAt:'2026-09-21T12:00:00Z'};
 assert.equal(check(previous,{...previous,sapReturns:[record]}),null);
 assert.match(check(previous,{...previous,sapReturns:[{...record,confirmed:false}]}),/Confirme/);
 assert.match(check(previous,{...previous,sapReturns:[{...record,reason:''}]}),/observação/);
 assert.match(check(previous,{...previous,sapReturns:[record]},{...access,directFuelUser:{perfil:'Gestor',acoes:[]}}),/não permite incluir/);
 const saved={...previous,sapReturns:[record]};assert.match(check(saved,{...saved,sapReturns:[record,{...record,id:'MAN2',purchaseOrder:'4502'}]}),/já possui pedido/);
});
