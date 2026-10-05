import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/directfuel-online.js',import.meta.url),'utf8');
const check=source.slice(source.indexOf('  async function checkApplicationVersion()'),source.indexOf('  async function pull('));
const pull=source.slice(source.indexOf('  async function pull('),source.indexOf('  async function flushDanfes('));
test('new release remains visible while a data conflict blocks synchronization',async()=>{
 const events=[];const ctx={saving:false,pending:false,blockedByConflict:true,staleApplication:false,window:{DIRECTFUEL_APP_VERSION:'134',directFuelVersionMismatch:()=>events.push('button')},fetch:async()=>({ok:true,json:async()=>({applicationVersion:'135'})}),saveRecoveryDraft:()=>events.push('draft'),pill:text=>events.push(text),console};
 vm.createContext(ctx);await vm.runInContext(check+pull+'\npull(false)',ctx);
 assert.equal(ctx.staleApplication,true);assert.ok(events.includes('button'));assert.ok(events.includes('draft'));
});
test('a real conflict without a release does not show a false update notice',async()=>{
 const ctx={saving:false,pending:false,blockedByConflict:true,staleApplication:false,window:{DIRECTFUEL_APP_VERSION:'135',directFuelVersionMismatch:()=>assert.fail('unexpected banner')},fetch:async()=>({ok:true,json:async()=>({applicationVersion:'135'})}),console};vm.createContext(ctx);await vm.runInContext(check+pull+'\npull(false)',ctx);assert.equal(ctx.staleApplication,false);
});
