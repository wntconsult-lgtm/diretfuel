import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/directfuel-online.js',import.meta.url),'utf8');
const userChip=source.slice(source.indexOf('  function userChip('),source.indexOf('  async function readResponse('));
test('an existing user chip does not prevent granted or revoked permissions from refreshing',()=>{
 const context={window:{},db:{users:[]},document:{querySelector:()=>({}),getElementById:()=>({})}};
 vm.createContext(context);vm.runInContext(userChip,context);
 const base={email:'jakson@example.test',isOwner:false};
 context.userChip({...base,profile:'Administrador',permissions:['*'],actions:['*']});
 assert.equal(context.window.DIRECTFUEL_CURRENT_PROFILE,'Administrador');
 assert.deepEqual(context.window.DIRECTFUEL_ACTIONS,['*']);
 context.userChip({...base,profile:'Consulta',permissions:['medicoes'],actions:[]});
 assert.equal(context.window.DIRECTFUEL_CURRENT_PROFILE,'Consulta');
 assert.deepEqual(context.window.DIRECTFUEL_ACTIONS,[]);
 assert.equal(context.window.DIRECTFUEL_IS_OWNER,false);
});
