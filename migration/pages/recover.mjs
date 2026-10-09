import {config} from './config.mjs';
import {readRecovery,createRecovery} from './recovery.mjs';
const status=document.getElementById('activate-status'),button=document.getElementById('activate-submit');
const hash=location.hash;history.replaceState(null,'',location.pathname);
try{
 const tokens=readRecovery(hash);
 if(!window.supabase?.createClient)throw Error('Não foi possível carregar o acesso. Abra novamente o link do e-mail.');
 const client=window.supabase.createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const recover=createRecovery(client,tokens);
 document.getElementById('activate-form').onsubmit=async event=>{
  event.preventDefault();button.disabled=true;status.textContent='Salvando nova senha…';
  try{await recover(document.getElementById('new-password').value,document.getElementById('repeat-password').value);document.getElementById('activate-form').reset();document.getElementById('activate-form').hidden=true;status.textContent='Senha alterada. Volte ao acesso e entre com seu e-mail e sua nova senha.';}
  catch(e){status.textContent=e.message;}finally{button.disabled=false;}
 };
}catch(e){status.textContent=e.message;button.disabled=true;}
