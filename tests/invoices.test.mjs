import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const js=ts.transpileModule(readFileSync(new URL('../lib/directfuel-invoices.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {invoiceValidation}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

function state(noteCount=1) {
  const fuelings=Array.from({length:10},(_,i)=>({id:'a'+i,postoId:'p',medicaoId:'m',produtoId:'diesel',qt:10,total:60}));
  const notes=Array.from({length:noteCount},(_,i)=>{const linked=fuelings.slice(Math.floor(i*fuelings.length/noteCount),Math.floor((i+1)*fuelings.length/noteCount)),quantity=linked.reduce((sum,item)=>sum+item.qt,0),value=linked.reduce((sum,item)=>sum+item.total,0);return {id:'n'+i,numero:String(i+1),serie:'1',chave:String(i+1).padStart(44,'0'),cnpjEmitente:'12345678000190',emissao:'2026-09-09',quantidadeTotal:quantity,valorTotal:value,itensFiscais:[{codigoProdutoFiscal:'0015',quantidade:quantity,valorUnitario:6,valorTotal:value,produtoDirectFuelId:'diesel'}],parcelas:[{vencimento:'2026-09-25',valor:value}],abastecimentoIds:linked.map(item=>item.id),conferenciaConfirmada:true};});
  return {config:{params:{medicaoToleranciaValor:10,medicaoToleranciaPercentual:.1,medicaoToleranciaRegra:'maior'}},postos:[{id:'p',cnpj:'12.345.678/0001-90'}],acordos:[{id:'ac',postoId:'p',produtoId:'diesel',inicio:'2026-01-01',fim:'',status:'Vigente',fiscalProductMappings:[{codigoProdutoFiscal:'0015',produtoDirectFuelId:'diesel',ativo:true}]}],abastecimentos:fuelings,medicoes:[{id:'m',postoId:'p',itens:fuelings.map(x=>x.id),status:'Confirmado',conferenciaNfAtivada:true,notasFiscais:notes,qtNf:100,valorNf:600}]};
}

test('case 1: one fueling and one invoice reconciles',()=>{const s=state();s.abastecimentos=s.abastecimentos.slice(0,1);s.medicoes[0].itens=['a0'];s.medicoes[0].notasFiscais[0].abastecimentoIds=['a0'];s.medicoes[0].notasFiscais[0].quantidadeTotal=10;s.medicoes[0].notasFiscais[0].valorTotal=60;assert.equal(invoiceValidation(s),null);});
test('case 2: one consolidated invoice covers many fuelings',()=>assert.equal(invoiceValidation(state()),null));
test('case 3: several invoices reconcile against the measurement total',()=>assert.equal(invoiceValidation(state(3)),null));
test('case 4: total difference inside configured tolerance is accepted',()=>{const s=state();s.medicoes[0].notasFiscais[0].valorTotal=605;assert.equal(invoiceValidation(s),null);});
test('case 5: difference above total tolerance is blocked',()=>{const s=state();s.medicoes[0].notasFiscais[0].valorTotal=620;assert.match(invoiceValidation(s),/tolerância/);});
test('case 6: unidentified product is blocked',()=>{const s=state();s.medicoes[0].notasFiscais[0].itensFiscais[0].produtoDirectFuelId='';assert.match(invoiceValidation(s),/produtos fiscais/);});
test('case 7: unidentified station is blocked',()=>{const s=state();s.medicoes[0].notasFiscais[0].postoStatus='POSTO NÃO IDENTIFICADO';assert.match(invoiceValidation(s),/posto/);});
test('case 8: duplicate NF-e access key is blocked across measurements',()=>{const s=state();const copy=structuredClone(s.medicoes[0]);copy.id='m2';copy.itens=s.abastecimentos.map(item=>{const cloned={...item,id:item.id+'b',medicaoId:'m2'};s.abastecimentos.push(cloned);return cloned.id;});s.medicoes.push(copy);assert.match(invoiceValidation(s),/NF já cadastrada/);});
test('case 9: fueling cannot belong to two measurements',()=>{const s=state();s.medicoes.push({...structuredClone(s.medicoes[0]),id:'m2',notasFiscais:[]});assert.match(invoiceValidation(s),/outra medição/);});
test('case 10: multiple due dates remain valid',()=>{const s=state();s.medicoes[0].notasFiscais[0].parcelas=[{vencimento:'2026-09-20',valor:300},{vencimento:'2026-10-20',valor:300}];assert.equal(invoiceValidation(s),null);});
test('manual acceptance requires a useful justification',()=>{const s=state();s.medicoes[0].notasFiscais[0].valorTotal=650;s.medicoes[0].divergenciaAceita=true;s.medicoes[0].divergenciaJustificativa='ok';assert.match(invoiceValidation(s),/tolerância/);s.medicoes[0].divergenciaJustificativa='Crédito negociado com o posto';assert.equal(invoiceValidation(s),null);});
test('each fueling must belong to exactly one confirmed invoice',()=>{const s=state(2);s.medicoes[0].notasFiscais[1].abastecimentoIds=s.medicoes[0].notasFiscais[0].abastecimentoIds;assert.match(invoiceValidation(s),/mais de uma NF/);});
test('every invoice must be individually confirmed',()=>{const s=state(2);s.medicoes[0].notasFiscais[0].conferenciaConfirmada=false;assert.match(invoiceValidation(s),/Confirme a conferência/);});
test('legacy confirmed measurements remain valid until reopened in the new conference',()=>{const s=state();delete s.medicoes[0].conferenciaNfAtivada;delete s.medicoes[0].notasFiscais[0].conferenciaConfirmada;delete s.medicoes[0].notasFiscais[0].abastecimentoIds;assert.equal(invoiceValidation(s),null);});
test('De/Para must belong to an agreement valid on the invoice emission date',()=>{const s=state();s.acordos[0].inicio='2026-09-10';assert.match(invoiceValidation(s),/De\/Para válido/);s.acordos[0].inicio='2026-01-01';s.acordos[0].fim='2026-09-08';assert.match(invoiceValidation(s),/De\/Para válido/);s.acordos[0].fim='';assert.equal(invoiceValidation(s),null);});
test('closing an agreement does not reopen fiscal validation of unchanged approved measurements',()=>{const previous=state(),next=structuredClone(previous);next.acordos[0].fim='2026-09-08';next.acordos[0].status='Encerrado';assert.equal(invoiceValidation(next,previous),null);next.medicoes[0].notasFiscais[0].itensFiscais[0].descricao='Item fiscal alterado';assert.match(invoiceValidation(next,previous),/De\/Para válido/);});
test('returned measurement releases fuelings and no longer reserves its invoices',()=>{const s=state();const returned=s.medicoes[0];returned.status='Devolvida para pendentes';returned.itensDevolvidos=[...returned.itens];returned.itens=[];s.abastecimentos.forEach(item=>item.medicaoId=null);const replacement=structuredClone(state().medicoes[0]);replacement.id='m2';s.abastecimentos.forEach(item=>item.medicaoId='m2');s.medicoes.push(replacement);assert.equal(invoiceValidation(s),null);});
test('rejected measurement remains linked and keeps reserving its invoice',()=>{const s=state();s.medicoes[0].status='Rejeitada';const copy=structuredClone(s.medicoes[0]);copy.id='m2';copy.itens=s.abastecimentos.map(item=>{const cloned={...item,id:item.id+'b',medicaoId:'m2'};s.abastecimentos.push(cloned);return cloned.id;});s.medicoes.push(copy);assert.match(invoiceValidation(s),/NF já cadastrada/);});
test('partial save validates only the OK invoices and leaves the error batch outside the measurement',()=>{const s=state(2),measurement=s.medicoes[0],validNote=measurement.notasFiscais[0],validIds=[...validNote.abastecimentoIds],validSet=new Set(validIds);measurement.notasFiscais=[validNote];measurement.itens=validIds;s.abastecimentos.forEach(item=>item.medicaoId=validSet.has(item.id)?'m':null);s.nfPendencias=[{id:'nfp',status:'Pendente de correção',abastecimentoIds:s.abastecimentos.filter(item=>!item.medicaoId).map(item=>item.id),notasFiscais:[{numero:'2',errosLeitura:['Vencimento não identificado']}]}];assert.equal(invoiceValidation(s),null);});
test('partial save can confirm one NF and leave fuelings without NF available for a future measurement',()=>{const s=state(),measurement=s.medicoes[0],note=measurement.notasFiscais[0],included=s.abastecimentos[0];measurement.itens=[included.id];note.abastecimentoIds=[included.id];note.quantidadeTotal=included.qt;note.valorTotal=included.total;measurement.qt=included.qt;measurement.valor=included.total;measurement.qtNf=included.qt;measurement.valorNf=included.total;s.abastecimentos.forEach(item=>item.medicaoId=item.id===included.id?'m':null);s.nfPendencias=[];assert.equal(invoiceValidation(s),null);assert.equal(s.abastecimentos.filter(item=>!item.medicaoId).length,9);});
test('archived fiscal metadata remains valid without PDF extraction details',()=>{const s=state(),note=s.medicoes[0].notasFiscais[0];note.arquivada=true;delete note.itensFiscais;delete note.parcelas;note.vencimento='2026-09-25';assert.equal(invoiceValidation(s),null);});

test('volume tolerance accepts both signs at the limit and rejects excess',()=>{
  for(const sign of [-1,1])for(const [difference,accepted] of [[.02,true],[.021,false]]){
    const s=state();s.config.params.medicaoToleranciaVolume=.02;s.medicoes[0].notasFiscais[0].quantidadeTotal=100+sign*difference;
    const result=invoiceValidation(s);if(accepted)assert.equal(result,null);else assert.match(result,/quantidade/);
  }
});
test('aggregate volume cannot exceed tolerance even when each NF passes',()=>{
  const s=state(2);s.config.params.medicaoToleranciaVolume=.02;s.medicoes[0].notasFiscais.forEach(note=>note.quantidadeTotal+=.015);assert.match(invoiceValidation(s),/quantidade das NFs/);
});
test('zero is respected and legacy default remains 0.01 L',()=>{
  const s=state();s.medicoes[0].notasFiscais[0].quantidadeTotal+=.005;assert.equal(invoiceValidation(s),null);
  s.config.params.medicaoToleranciaVolume=0;assert.match(invoiceValidation(s),/quantidade/);
});
test('invalid volume configuration is rejected by server',()=>{
  for(const value of [-1,'0.02',NaN,Infinity]){const s=state();s.config.params.medicaoToleranciaVolume=value;assert.match(invoiceValidation(s),/tolerância de volume/);}
});
