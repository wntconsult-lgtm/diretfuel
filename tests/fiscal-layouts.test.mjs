import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const window={};for(const name of ['danfe-parser','layout-engine'])vm.runInNewContext(readFileSync(new URL(`../public/directfuel-${name}.js`,import.meta.url),'utf8'),{window});
const engine=window.DirectFuelLayouts,parser=window.DirectFuelDanfeParser;
const key='35260959149997000199550010001827151001015719';
const page=`RECEBEMOS DE CINADIS REVENDEDORA DE COMBUSTÍVEL LTDA OS PRODUTOS
DANFE 1 - SAÍDA 1 ${key.match(/.{4}/g).join(' ')}
Nº 000.182.715 SÉRIE 001 EMISSÃO 15/09/2026
DUPLICATAS
Nº DUPLICATA VENC. VALOR
001 30/09/2026 16.731,24
CÁLCULO DO IMPOSTO
VALOR TOTAL DA NOTA 16.731,24 TRANSPORTADOR
DADOS DO PRODUTO / SERVIÇOS
VALOR VALOR DESCONTO BASE VALOR VALOR ALÍQUOTAS
UNITÁRIO TOTAL CÁLC. ICMS
820101034 DIESEL S-10 COMUM 27101921 061 6929 L 1.322,03 6,4900 8.579,97 0,00 0,00 0,00
820101034 DIESEL S-10 COMUM 27101921 061 6929 L 1.180,00 6,5900 7.776,20 0,00 0,00 0,00
740101005 ARLA32 A GRANEL 31021010 060 6929 L 117,58 3,1900 375,07 0,00 0,00 0,00
DADOS ADICIONAIS
Projeto ACBr`;
const pages=[{pageNumber:1,text:page}],group=parser.groupPages(pages)[0],signature=engine.fingerprint(group),raw=parser.parseGroup(group);
const rules={totalColumn:'second',dueAnchor:'DUPLICATAS',issuerStart:'RECEBEMOS DE',issuerEnd:'OS PRODUTOS'};
const layout={id:'L1',stationId:'S1',name:'ACBr',cnpj:'59149997000199',fingerprint:signature,version:1,status:'validated',active:true,rules};
test('recognition is scoped to CNPJ and fingerprint and never applies drafts',()=>{
 assert.equal(engine.read(pages,[layout])[0].layoutId,'L1');
 for(const changed of [{...layout,cnpj:'00000000000000'},{...layout,fingerprint:'different'},{...layout,status:'draft'},{...layout,active:false}])assert.equal(engine.read(pages,[changed])[0].layoutStatus,'review');
});
test('same structure reuses a signature across amounts, dates and product descriptions',()=>{
 const modified={pages:[{pageNumber:1,text:page.replaceAll('16.731,24','9.876,54').replaceAll('DIESEL S-10 COMUM','DIESEL S-10 ADITIVADO').replaceAll('30/09/2026','10/10/2026')}]};
 assert.equal(engine.fingerprint(modified),signature);
 assert.notEqual(engine.fingerprint({pages:[{pageNumber:1,text:page.replace('UNITÁRIO TOTAL CÁLC. ICMS','TOTAL UNITÁRIO CÁLC. ICMS')}]}),signature);
});
test('rules preserve identity, separate prices and totals; invalid rules fail validation',()=>{
 const result=engine.read(pages,[layout])[0],expected=engine.summary(raw);
 assert.deepEqual([...engine.validate(result,expected)],[]);
 assert.equal(result.numero,'182715');assert.equal(result.cnpjEmitente,'59149997000199');
 assert.deepEqual(Array.from(result.itensFiscais,x=>x.valorUnitario),[6.49,6.59,3.19]);
 const bad=parser.parseGroup(group,{...rules,totalColumn:'fourth'});assert.ok(engine.validate(bad,expected).length);
 assert.ok(engine.validate(result,{...expected,cnpj:'different'}).length);
});
test('restoring a validated version changes the selected rules without erasing other formats',()=>{
 const newer={...layout,id:'L2',version:2,active:true};
 assert.equal(engine.select([{...layout,active:false},newer],layout.cnpj,signature).id,'L2');
 assert.equal(engine.select([layout,{...newer,active:false}],layout.cnpj,signature).id,'L1');
});
const transpile=name=>ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=js=>'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const {authorizeChanges,analyzeChanges}=await import(url(transpile('directfuel-security').replace('"./directfuel-invoices"',JSON.stringify(url(transpile('directfuel-invoices'))))));
const actor={isOwner:false,user:{email:'editor@example.test'},directFuelUser:{perfil:'Gestor',acoes:['postos:incluir','postos:editar','postos:aprovar']}};
const reference={documentId:'NF_LAYOUT_REF1',filename:'danfe.pdf',sha256:'a'.repeat(64),expected:engine.summary(raw)};
const valid={...layout,active:false,reason:'Conferência do layout',reference,test:{passed:true,confirmed:true,errors:[],adjusted:raw,original:raw},history:[{action:'Criada'}]};
const base={postos:[{id:'S1',cnpj:layout.cnpj}],fiscalLayouts:[]};
const check=(before,after,access=actor)=>authorizeChanges(access,before,after,analyzeChanges(before,after));
test('new layout versions require creation grant and cannot start active',()=>{
 assert.equal(check(base,{...base,fiscalLayouts:[valid]}),null);
 assert.match(check(base,{...base,fiscalLayouts:[{...valid,active:true}]}),/antes de ativ/);
 assert.match(check(base,{...base,fiscalLayouts:[valid]},{...actor,directFuelUser:{acoes:[]}}),/não permite incluir/);
});
test('activation requires approval grant; version rules and history cannot be overwritten or deleted',()=>{
 const before={...base,fiscalLayouts:[valid]},activated={...valid,active:true,history:[...valid.history,{action:'Ativada'}]};
 assert.equal(check(before,{...base,fiscalLayouts:[activated]}),null);
 assert.match(check(before,{...base,fiscalLayouts:[activated]},{...actor,directFuelUser:{acoes:['postos:editar']}}),/não permite ativar/);
 assert.match(check(before,{...base,fiscalLayouts:[{...activated,rules:{...rules,totalColumn:'fourth'}}]}),/imutáveis/);
 assert.match(check(before,{...base,fiscalLayouts:[]},{...actor,directFuelUser:{acoes:['*']}}),/histórico/);
 const draft={...valid,status:'draft',test:{passed:false}};
 assert.match(check({...base,fiscalLayouts:[draft]},{...base,fiscalLayouts:[{...draft,active:true,history:[...draft.history,{action:'Ativada'}]}]}),/Valide/);
});
test('singular product heading extracts liters and optional due date never bypasses quantity',()=>{
 const text=`RECEBEMOS DE AUTO POSTO REI DA CASTELO LTDA OS PRODUTOS
35260958812348000163550020000080161501651279
DATA EMISSÃO 08/09/2026
FATURA/DUPLICATA
CÁLCULO DO IMPOSTO
VALOR TOTAL DA NOTA 69,01 TRANSPORTADOR
DADOS DO PRODUTO/SERVIÇO
CÓD.PROD. DESCRIÇÃO NCM CST CFOP UNIDADE QUANTIDADE V.UNITÁRIO V.TOTAL BC ICMS
72919 ARLA 32 GRANEL BIOARLA 31021010 000 5102 l 23,081 2,990 69,01 69,01 12,42 0,00
DADOS ADICIONAIS`;
 const group=parser.groupPages([{pageNumber:1,text}])[0];
 const raw=parser.parseGroup(group);assert.equal(raw.itensFiscais[0].quantidade,23.081);assert.equal(raw.itensFiscais[0].valorTotal,69.01);assert.ok(raw.errosLeitura.some(e=>e.includes('Vencimento')));
 const note=parser.parseGroup(group,{allowMissingDue:true});assert.equal(note.vencimento,'');assert.deepEqual([...engine.validate(note,engine.summary(note))],[]);
 assert.ok(engine.validate(note,{...engine.summary(note),quantidade:0}).some(e=>e.includes('Quantidade')));
 const numeric=parser.groupPages([{pageNumber:1,text:text.replace('5102 l ','5102 1 ')}])[0];assert.equal(parser.parseGroup(numeric).itensFiscais.length,0);assert.equal(parser.parseGroup(numeric,{numericUnit:true}).itensFiscais[0].quantidade,23.081);
});
