import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/directfuel-online.js',import.meta.url),'utf8');
const pull=source.slice(source.indexOf('  async function pull('),source.indexOf('  async function flushDanfes('));
function context(){const state={medicoes:[{numero:'MED-2026-0007'}],acordos:[{fiscalProductMappings:[{codigoProdutoFiscal:'000056'}]}]};let resolve;
 const ctx={saving:false,pending:false,blockedByConflict:false,staleApplication:false,localRevision:0,pullRequestId:0,remoteVersion:7,db:state,window:{DIRECTFUEL_APP_VERSION:'136'},document:{querySelector:()=>null,getElementById:()=>null},fetch:()=>new Promise(r=>resolve=r),readResponse:async x=>x,console};vm.createContext(ctx);vm.runInContext(pull,ctx);return {ctx,finish:()=>resolve({applicationVersion:'136',version:6,state:{medicoes:[],acordos:[]}})};}
test('late read cannot erase measurement and fiscal mappings after a local save',async()=>{const {ctx,finish}=context();const p=ctx.pull();ctx.localRevision++;ctx.pending=true;finish();await p;assert.equal(ctx.db.medicoes[0].numero,'MED-2026-0007');assert.equal(ctx.db.acordos[0].fiscalProductMappings[0].codigoProdutoFiscal,'000056');assert.equal(ctx.remoteVersion,7);});
test('late read is ignored even after local save has already finished',async()=>{const {ctx,finish}=context();const p=ctx.pull();ctx.localRevision++;ctx.pending=false;ctx.remoteVersion=8;finish();await p;assert.equal(ctx.remoteVersion,8);assert.equal(ctx.db.medicoes.length,1);});
test('opening an editor while a read is in flight prevents data replacement',async()=>{const {ctx,finish}=context();const p=ctx.pull();ctx.document.querySelector=()=>({});finish();await p;assert.equal(ctx.db.medicoes.length,1);});
