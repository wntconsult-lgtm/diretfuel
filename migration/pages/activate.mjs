import {config} from './config.mjs';
import {readActivation,createActivation} from './activation.mjs';
const status=document.getElementById('activate-status'),button=document.getElementById('activate-submit');
const hash=location.hash;history.replaceState(null,'',location.pathname+location.search);
try{
 const token=readActivation(hash);
 if(!window.supabase?.createClient)throw Error('Não foi possível carregar o acesso. Abra novamente o link.');
 // Separate ephemeral session: activation cannot replace the owner's logged-in session.
 const client=window.supabase.createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const activate=createActivation(client,token);
 document.getElementById('activate-form').onsubmit=async event=>{event.preventDefault();button.disabled=true;status.textContent='Definindo sua senha…';try{await activate(document.getElementById('new-password').value,document.getElementById('repeat-password').value);document.getElementById('activate-form').reset();document.getElementById('activate-form').hidden=true;status.textContent='Senha definida. Volte ao acesso e entre com seu e-mail e sua senha.';}catch(e){status.textContent=e.message;}finally{button.disabled=false;}};
}catch(e){status.textContent=e.message;button.disabled=true;}
