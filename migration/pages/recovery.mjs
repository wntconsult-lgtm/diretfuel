import { validatePassword } from './activation.mjs';
export const RECOVERY_URL='https://directfuel.com.br/recover.html';
export async function requestRecovery(client,email){
 email=String(email||'').trim();
 if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw Error('Informe um e-mail válido.');
 const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:RECOVERY_URL});
 if(error){
  if(error.status===429)throw Error('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
  throw Error('Não foi possível solicitar a recuperação. Tente novamente mais tarde. Se continuar, contate o administrador para conferir o envio de e-mails no Supabase.');
 }
 return 'Se o e-mail estiver cadastrado e o envio estiver disponível, você receberá um link para definir uma nova senha. Confira também o spam.';
}
export function readRecovery(hash){
 const p=new URLSearchParams(String(hash||'').replace(/^#/,''));
 if(p.has('error')||p.has('error_code'))throw Error('O link expirou ou já foi usado. Solicite outro em Esqueci minha senha.');
 if(p.get('type')!=='recovery')throw Error('Abra o link de recuperação recebido por e-mail.');
 const access_token=p.get('access_token'),refresh_token=p.get('refresh_token');
 if(!access_token||!refresh_token||access_token.length>16384||refresh_token.length>2048)throw Error('Link incompleto. Solicite outro em Esqueci minha senha.');
 return {access_token,refresh_token};
}
export function createRecovery(client,tokens){
 let verified=false,completed=false;
 return async(password,repeated)=>{
  if(completed)throw Error('A senha já foi alterada. Volte ao acesso.');
  validatePassword(password,repeated);
  if(!verified){const result=await client.auth.setSession(tokens);if(result.error||!result.data?.session)throw Error('O link expirou ou já foi usado. Solicite outro em Esqueci minha senha.');verified=true;}
  const {error}=await client.auth.updateUser({password});
  if(error)throw Error('Não foi possível salvar. Use uma senha nova de 12 a 128 caracteres e tente novamente.');
  completed=true;
  try{await client.auth.signOut({scope:'local'});}catch{/* The recovery client never persists its session. */}
 };
}
