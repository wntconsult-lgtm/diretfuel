(async () => {
  if (window.DIRECTFUEL_BOOT_STARTED) return;
  window.DIRECTFUEL_BOOT_STARTED = true;
  const version = document.getElementById('directfuel-loading').dataset.version;
  window.DIRECTFUEL_APP_VERSION = version;
  const fail = message => {
    document.getElementById('directfuel-loading-message').textContent = message;
    document.getElementById('directfuel-loading-retry').hidden = false;
  };
  window.directFuelVersionMismatch = () => {
    if (document.getElementById('directfuel-loading')) { fail('Uma nova versão está disponível. Recarregue o sistema.'); return; }
    if (document.getElementById('directfuel-update')) return;
    const banner = document.createElement('div'); banner.id='directfuel-update'; banner.role='alert';
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:16px;background:#fff3cd;color:#513e00;text-align:center';
    banner.textContent='Nova versão disponível. Atualize o sistema para continuar com as melhorias. Copie os campos ainda não salvos antes de atualizar. ';
    const button=document.createElement('button'); button.className='btn secondary';button.textContent='Atualizar sistema';
    button.onclick=()=>{if(confirm('Recarregar o sistema? Alterações ainda não salvas serão perdidas.'))location.reload();};banner.append(button);document.body.append(banner);
  };
  const load = src => new Promise((resolve,reject) => {
    const script = document.createElement('script'); script.async=false;
    let runtimeError;
    const onError=e=>{if(e.filename && new URL(e.filename,location.href).pathname===new URL(src,location.href).pathname)runtimeError=e.error || new Error(e.message);};
    window.addEventListener('error',onError);
    const timeout=setTimeout(()=>{cleanup();reject(new Error('O carregamento demorou mais que o esperado. Recarregue o sistema.'));},30000);
    function cleanup(){clearTimeout(timeout);window.removeEventListener('error',onError);}
    script.onload=()=>{cleanup();runtimeError?reject(runtimeError):resolve();};
    script.onerror=()=>{cleanup();reject(new Error('Não foi possível carregar todos os componentes. Recarregue o sistema.'));};
    script.src=src;document.head.append(script);
  });
  try {
    await load('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    // Dependencies and overrides must execute in this exact order.
    for(const name of ['state-delta','import-rules','app','online','enhancements','reports-calculator','rc-sap','enterprise','enterprise-v2','enterprise-v3','security','dashboard-financial','dashboard-v2','access-control','access-log','geo','danfe-parser','layout-engine','reconciliation','invoices','layouts','sap-return','sap-return-ui','accounting-report','ticketlog','volume','storage-ui','completed-documents']) {
      await load(`/directfuel-${name}.js?v=${encodeURIComponent(version)}`);
    }
    if(typeof window.directFuelStartSync!=='function') throw new Error('Não foi possível iniciar a sincronização.');
    await Promise.race([window.directFuelStartSync(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Não foi possível carregar os dados a tempo. Recarregue o sistema.')),30000))]);
    render();
    document.getElementById('directfuel-loading-style').remove();
    document.getElementById('directfuel-loading').remove();
  } catch(error) { console.error('DirectFuel startup failed',error);fail(error.message || 'Falha no carregamento. Recarregue o sistema.'); }
})();
