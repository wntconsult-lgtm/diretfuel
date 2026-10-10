const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export async function handleTeam({method,body,rpc,fetchImpl,url,serviceKey}){
 if(method==='GET')return rpc('directfuel_team',{p_action:'list'});
 if(method!=='POST')throw fail('Método não permitido.',405);
 if(body.action==='disable')return rpc('directfuel_team',{p_action:'disable',p_id:body.id});
 if(body.action!=='activate'||body.confirmation!=='LIBERAR ACESSO')throw fail('Confirme a liberação individual de acesso.');
 const candidate=await rpc('directfuel_team',{p_action:'candidate',p_id:body.id});
 if(body.version!==candidate.version)throw fail('O cadastro mudou. Atualize os acessos.',409);
 async function generate(type){
  const response=await fetchImpl(`${url}/auth/v1/admin/generate_link`,{method:'POST',headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'},body:JSON.stringify({type,email:candidate.email}),signal:AbortSignal.timeout(10000)});
  const data=await response.json();return {response,data};
 }
 let type=candidate.bound?'recovery':'invite',result=await generate(type);
 if(!result.response.ok&&type==='invite'&&['email_exists','user_already_exists'].includes(result.data.error_code||result.data.code)){type='recovery';result=await generate(type);}
 if(!result.response.ok)throw fail('Não foi possível gerar o acesso. Aguarde e tente novamente.',result.response.status===429?429:503);
 const token=result.data.hashed_token||result.data.properties?.hashed_token,user=result.data.user||result.data;
 const actualType=result.data.verification_type||result.data.properties?.verification_type||type;
 if(!/^[a-f0-9]{32,128}$/i.test(token||'')||!['invite','recovery'].includes(actualType)||!user.id||String(user.email||'').toLowerCase()!==candidate.email)throw fail('Não foi possível validar o acesso gerado.',503);
 await rpc('directfuel_team',{p_action:'activate',p_id:body.id,p_metadata:{authUserId:user.id,version:candidate.version}});
 const link=`https://directfuel.com.br/activate.html#token_hash=${encodeURIComponent(token)}&type=${actualType}`;
 // Link and OTP are never persisted, logged, emailed or included in business state.
 return {ok:true,email:candidate.email,profile:candidate.profile,link};
}
