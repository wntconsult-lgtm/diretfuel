export function readActivation(hash){
 const params=new URLSearchParams(String(hash||'').replace(/^#/,'')),token=params.get('token_hash'),type=params.get('type');
 if(!/^[a-f0-9]{32,128}$/i.test(token||'')||!['invite','recovery'].includes(type))throw Error('Link inválido ou ausente. Solicite um novo link ao proprietário.');
 return {token_hash:token,type};
}
export function validatePassword(password,repeated){if(password.length<12||password.length>128)throw Error('A senha deve ter entre 12 e 128 caracteres.');if(password!==repeated)throw Error('As senhas precisam ser iguais.');}
export function createActivation(client,token){
 let accepted=false;
 return async(password,repeated)=>{
  validatePassword(password,repeated);
  if(!accepted){const verified=await client.auth.verifyOtp(token);if(verified.error||!verified.data?.session)throw Error('O link expirou ou já foi usado. Solicite um novo link ao proprietário.');accepted=true;}
  const {error}=await client.auth.updateUser({password});if(error)throw Error('Não foi possível salvar a senha. Confira as regras e tente novamente.');
  await client.auth.signOut({scope:'local'});
 };
}
