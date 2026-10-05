import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('Auditoria navigation opens the currently registered audit page',()=>{
 const source=readFileSync(new URL('../public/directfuel-app.js',import.meta.url),'utf8');
 const render=source.split('\n').find(line=>line.startsWith('function render(){'));
 const calls=[];const context={route:'audit',renderNav:()=>calls.push('nav')};
 for(const name of ['dashboard','postos','bases','distribuidoras','produtos','unidades','frota','rede','acordos','abastecimentos','medicoes','relatorios','documentos','config','auditPage'])context[name]=()=>calls.push(name);
 vm.runInNewContext(render+';render();',context);assert.deepEqual(calls,['nav','auditPage']);
 context.auditPage=()=>calls.push('volume');vm.runInNewContext('render();',context);assert.equal(calls.at(-1),'volume');
});
