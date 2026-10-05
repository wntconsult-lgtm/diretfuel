import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const transpile = name => ts.transpileModule(readFileSync(new URL('../lib/'+name+'.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const url = js => 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const {validateBusinessRules} = await import(url(transpile('directfuel-security').replace('"./directfuel-invoices"', JSON.stringify(url(transpile('directfuel-invoices'))))));
const agreement = {id:'ac',postoId:'roma',produtoId:'diesel',inicio:'2026-01-01',status:'Vigente'};
const state = a => ({acordos:[a]});
const mapping = {codigoProdutoFiscal:'000056',produtoDirectFuelId:'diesel',ativo:true};
test('fiscal edits on legacy agreements preserve absent, empty and old payment values',()=>{
  for(const value of [undefined,'',null,'Legado']){
    const old={...agreement}; if(value!==undefined)old.condicaoPagamento=value;
    const next={...old,fiscalProductMappings:[mapping]};
    assert.equal(validateBusinessRules(state(old),state(next)),null);
    assert.equal(next.condicaoPagamento,value);
  }
});
test('new agreements require an explicit supported payment condition',()=>{
  for(const value of [undefined,'','Pix'])assert.match(validateBusinessRules({},state({...agreement,condicaoPagamento:value})),/condição de pagamento/);
  for(const value of ['Boleto','Depósito'])assert.equal(validateBusinessRules({},state({...agreement,condicaoPagamento:value})),null);
});
test('existing payment cannot be removed or changed to an unsupported value',()=>{
  const old={...agreement,condicaoPagamento:'Boleto'};
  for(const value of [undefined,'',null,'Pix'])assert.match(validateBusinessRules(state(old),state({...old,condicaoPagamento:value})),/condição de pagamento/);
  assert.equal(validateBusinessRules(state(old),state({...old,condicaoPagamento:'Depósito'})),null);
});
test('legacy payment exception still validates fiscal product mapping',()=>{
  assert.match(validateBusinessRules(state(agreement),state({...agreement,fiscalProductMappings:[{...mapping,produtoDirectFuelId:'wrong'}]})),/mesmo produto/);
});
