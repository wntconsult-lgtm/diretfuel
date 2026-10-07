import {config} from './config.mjs';
import {createGateway} from './gateway.mjs';
async function start(){
 if(!window.supabase?.createClient)throw Error('Não foi possível carregar o login. Volte ao portal e tente novamente.');
 const client=window.supabase.createClient(config.url,config.publicKey,{auth:{storage:sessionStorage,storageKey:'directfuel-migration-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
 const {data,error}=await client.auth.getSession();
 if(error || !data.session){location.replace('../');return;}
 const nativeFetch=window.fetch.bind(window), gateway=createGateway(client,config,nativeFetch);
 window.fetch=gateway;
 window.directFuelMigrationSignout=async()=>{try{await client.auth.signOut({scope:'local'});}finally{await client.auth.stopAutoRefresh();sessionStorage.removeItem('directfuel-migration-auth');location.replace('../');}};
 const open=window.open.bind(window);
 const isPrivate=value=>{try{const u=new URL(value,location.href);return u.origin===location.origin&&(u.pathname.startsWith('/api/documents/') || u.pathname==='/api/security'&&u.searchParams.has('downloadBackup'));}catch{return false;}};
 async function privateFile(href,popup,filename){
  try{
   const response=await gateway(href);
   if(!response.ok){const data=await response.json();throw Error(data.error || 'Arquivo indisponível.');}
   const blob=URL.createObjectURL(await response.blob());
   if(filename){const a=document.createElement('a');a.href=blob;a.download=filename;a.click();}
   else if(popup){popup.location.replace(blob);}
   else {const a=document.createElement('a');a.href=blob;a.download='directfuel-documento';a.click();}
   setTimeout(()=>URL.revokeObjectURL(blob),120000);
  }catch(error){popup?.close();alert(error.message);}
 }
 window.open=(href,...args)=>{
  if(!isPrivate(href))return open(href,...args);
  const popup=open('about:blank','_blank');if(popup)popup.opener=null;
  void privateFile(href,popup);return popup;
 };
 document.addEventListener('click',event=>{
  const a=event.target.closest('a');if(!a)return;
  if(a.hasAttribute('data-migration-signout') || a.getAttribute('href')?.startsWith('/signout-with-chatgpt')){event.preventDefault();void window.directFuelMigrationSignout();return;}
  if(isPrivate(a.href)){event.preventDefault();const popup=a.hasAttribute('download')?null:open('about:blank','_blank');if(popup)popup.opener=null;void privateFile(a.href,popup,a.getAttribute('download')||null);}
 },true);
 const script=document.createElement('script');script.src='./directfuel-bootstrap.js';script.onerror=()=>{document.getElementById('directfuel-loading-message').textContent='Não foi possível carregar o sistema. Recarregue.';document.getElementById('directfuel-loading-retry').hidden=false;};document.head.append(script);
}
start().catch(error=>{document.getElementById('directfuel-loading-message').textContent=error.message;document.getElementById('directfuel-loading-retry').hidden=false;});
