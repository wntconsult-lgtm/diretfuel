import test from 'node:test';
import assert from 'node:assert/strict';
import {accessOf,clientState,mergeClientPayload} from '../supabase/functions/directfuel-api/access.mjs';
import {createHandler,prepareState} from '../supabase/functions/directfuel-api/handler.mjs';
import {createHandler as createPreview} from '../supabase/functions/directfuel-preview/handler.mjs';
import {handleTeam} from '../supabase/functions/directfuel-api/team.mjs';
import {readActivation,createActivation} from '../migration/pages/activation.mjs';
const member={email:'member@example.test',profile:'Usuário',permissions:['postos'],actions:['postos:editar'],isOwner:false};
const state={users:[{id:'owner',email:'owner@example.test',perfil:'Master'},{id:'member',email:member.email,perfil:'Usuário'}],config:{name:'Synthetic'},postos:[{id:'station',fantasia:'Synthetic'}],abastecimentos:[],medicoes:[],ticketlogFuelings:[{id:'private'}],importedAuditHistory:[{id:'private'}],audit:[{id:'private'}]};
test('members receive their own user and permitted collections, with hidden data preserved on saves',()=>{
 const access=accessOf(member),visible=clientState(state,access);
 assert.deepEqual(visible.users,[state.users[1]]);assert.deepEqual(visible.audit,[]);assert.deepEqual(visible.ticketlogFuelings,[]);assert.deepEqual(visible.importedAuditHistory,[]);
 const proposed={...visible,postos:[{...visible.postos[0],fantasia:'Updated'}]};
 const merged=mergeClientPayload(state,{state:proposed},access).state;
 assert.deepEqual(merged.ticketlogFuelings,state.ticketlogFuelings);assert.deepEqual(merged.users,state.users);
 const next=prepareState(state,{state:proposed},access).next;
 assert.equal(next.postos[0].fantasia,'Updated');assert.deepEqual(next.users,state.users);assert.deepEqual(next.ticketlogFuelings,state.ticketlogFuelings);
 for(const payload of [{delta:{users:{}}},{delta:{ticketlogFuelings:{}}},{state:{...visible,newSecret:[]}},{state:{...visible,users:[{...state.users[1],perfil:'Master'}]}},{state:{...visible,config:{name:'Changed'}}}])assert.throws(()=>prepareState(state,payload,access),error=>error.status===403);
 assert.throws(()=>prepareState(state,{state:proposed},accessOf({...member,actions:[]})),error=>error.status===403);
});
test('dedicated endpoints reject denied reads, mutations and owner operations before a write',async()=>{
 let writes=0;const fetchImpl=async(target)=>{
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'synthetic-user',email:member.email,email_confirmed_at:'2026-01-01',role:'authenticated',user_metadata:{profile:'Master',isOwner:true}});
  if(target.endsWith('/directfuel_state_read'))return Response.json({state,version:3,user:member});
  if(target.endsWith('/directfuel_audit'))return Response.json({ok:true});
  writes++;throw Error('Unexpected privilege');
 };const handler=createHandler({url:'https://synthetic.example.test',serviceKey:'synthetic-secret',fetchImpl});
 const request=(route,body)=>new Request('https://synthetic.example.test/functions/v1/directfuel-api/'+route,{method:body?'POST':'GET',headers:{authorization:'Bearer synthetic',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await handler(request('state'));assert.equal(result.status,200);assert.deepEqual((await result.json()).state.ticketlogFuelings,[]);
 for(const [route,body] of [['ticketlog'],['geo-analysis'],['volume-audit'],['import'],['storage/retention'],['security',{action:'restore_backup',id:'x'}],['accounting-report',{measurementIds:[]}]])assert.equal((await handler(request(route,body))).status,403);
 assert.equal(writes,0);
});
test('read-only geography members cannot mutate reviews even with editable JWT metadata',async()=>{
 const user={...member,permissions:['analysis_geo'],actions:[]};let writes=0;
 const handler=createHandler({url:'https://synthetic.example.test',serviceKey:'synthetic-secret',fetchImpl:async target=>{
  if(target.endsWith('/user'))return Response.json({id:'synthetic',email:user.email,email_confirmed_at:'2026-01-01',role:'authenticated',user_metadata:{actions:['*']}});
  if(target.endsWith('/directfuel_state_read'))return Response.json({state,version:3,user});writes++;throw Error('Must not write');
 }});
 const result=await handler(new Request('https://synthetic.example.test/functions/v1/directfuel-api/geo-analysis',{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:JSON.stringify({action:'review-station'})}));
 assert.equal(result.status,403);assert.equal(writes,0);
});
test('native membership rejection remains a 403 so the portal revokes its local session',async()=>{
 const handler=createPreview({url:'https://synthetic.example.test',serviceKey:'synthetic-secret',fetchImpl:async target=>target.endsWith('/user')?Response.json({id:'synthetic',email:member.email,email_confirmed_at:'2026-01-01',role:'authenticated'}):Response.json({code:'PT403',message:'private'},{status:403})});
 const response=await handler(new Request('https://synthetic.example.test/functions/v1/directfuel-preview/status',{headers:{authorization:'Bearer synthetic'}}));assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/private/);
});
test('team links require individual confirmation and current revision before generating Auth credentials',async()=>{
 const calls=[],candidate={email:member.email,profile:'Usuário',version:3,bound:false};
 const args={method:'POST',url:'https://synthetic.example.test',serviceKey:'synthetic-secret',rpc:async(name,p)=>{calls.push(p);return p.p_action==='candidate'?candidate:{ok:true};},fetchImpl:async(target,options)=>{calls.push(JSON.parse(options.body));return Response.json({id:'synthetic-auth-id',email:member.email,hashed_token:'a'.repeat(64),verification_type:'invite',email_otp:'do-not-return'});}};
 await assert.rejects(()=>handleTeam({...args,body:{action:'activate',id:'member',version:3}}));assert.equal(calls.length,0);
 await assert.rejects(()=>handleTeam({...args,body:{action:'activate',id:'member',version:2,confirmation:'LIBERAR ACESSO'}}),e=>e.status===409);assert.equal(calls.length,1);
 calls.length=0;
 const result=await handleTeam({...args,body:{action:'activate',id:'member',version:3,confirmation:'LIBERAR ACESSO',profile:'Master',permissions:['*']}});
 assert.equal(result.profile,'Usuário');assert.equal(new URL(result.link).pathname,'/diretfuel/activate.html');assert.deepEqual(calls[1],{type:'invite',email:member.email});assert.deepEqual(calls[2].p_metadata,{authUserId:'synthetic-auth-id',version:3});assert.doesNotMatch(JSON.stringify(result),/do-not-return|synthetic-secret/);
});
test('an existing account receives a recovery link, and mismatched identities are never bound',async()=>{
 let bound=0,generated=[];
 const args={method:'POST',body:{action:'activate',id:'member',version:3,confirmation:'LIBERAR ACESSO'},url:'https://synthetic.example.test',serviceKey:'synthetic-secret',rpc:async(name,p)=>{if(p.p_action==='candidate')return {email:member.email,profile:'Usuário',version:3,bound:false};bound++;return {ok:true};},fetchImpl:async(target,options)=>{const type=JSON.parse(options.body).type;generated.push(type);return type==='invite'?Response.json({error_code:'email_exists'},{status:422}):Response.json({user:{id:'synthetic-id',email:member.email},properties:{hashed_token:'b'.repeat(64),verification_type:'recovery'}});}};
 const result=await handleTeam(args);assert.deepEqual(generated,['invite','recovery']);assert.equal(bound,1);assert.match(result.link,/type=recovery/);
 await assert.rejects(()=>handleTeam({...args,fetchImpl:async()=>Response.json({id:'wrong',email:'wrong@example.test',hashed_token:'c'.repeat(64),verification_type:'invite'})}),e=>e.status===503);assert.equal(bound,1);
});
test('password activation validates input before consuming the link and can retry a failed password update',async()=>{
 assert.throws(()=>readActivation('#token_hash=bad&type=invite'));assert.throws(()=>readActivation('#token_hash='+ 'a'.repeat(64)+'&type=signup'));
 const token=readActivation('#token_hash='+ 'a'.repeat(64)+'&type=invite');let verified=0,updated=0,signedOut=0;
 const activate=createActivation({auth:{verifyOtp:async t=>{assert.deepEqual(t,token);verified++;return {data:{session:{access_token:'synthetic'}}};},updateUser:async()=>({error:++updated===1?{message:'temporary'}:null}),signOut:async()=>{signedOut++;}}},token);
 await assert.rejects(()=>activate('short','short'));assert.equal(verified,0);
 await assert.rejects(()=>activate('synthetic-password','different'));assert.equal(verified,0);
 await assert.rejects(()=>activate('synthetic-password','synthetic-password'));assert.equal(verified,1);assert.equal(signedOut,0);
 await activate('synthetic-password','synthetic-password');assert.equal(verified,1);assert.equal(updated,2);assert.equal(signedOut,1);
});
