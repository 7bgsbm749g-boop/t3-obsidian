// Synthetic native Android fixture. Never evaluate in a production vault.
(() => {
  const app=globalThis.app,key='t3-owned-pending-reload-fixture';
  if(app?.vault.getName()!=='T3 Mobile Lab')throw Error('Use the isolated Android lab.');
  const plugin=()=>{const p=app.plugins.plugins['t-three-code'];if(!p?.pendingClientReload)throw Error('Pending reload support has not loaded.');return p;};
  const paths=client=>({request:`${app.vault.configDir}/t-three-code-reload-request-v1-${client}.json`,result:`${app.vault.configDir}/t-three-code-reload-result-v1-${client}.json`});
  let listener;
  const snapshot=async()=>{
    const fixture=JSON.parse(localStorage.getItem(key)||'null');if(!fixture)return {present:false};
    const p=plugin(),file=paths(fixture.request.clientId).result;
    let result;try{result=JSON.parse(await app.vault.adapter.read(file));}catch{result=null;}
    return {mobile:app.isMobile,vault:app.vault.getName(),request:fixture.request,before:fixture.before,client:p.clientMaintenance.client,status:p.pendingClientReload.state?.status,result,rawPaths:fixture.rawPaths??[],journalAtDispatch:fixture.journalAtDispatch};
  };
  globalThis.__t3PendingReloadLab={
    async prepare(version,hashes){
      const p=plugin(),files=paths(p.deviceId);
      if(localStorage.getItem(key)||await app.vault.adapter.exists(files.request))throw Error('Clean the owned pending-reload fixture first.');
      const request={version:1,id:crypto.randomUUID(),vaultId:p.settings.vaultId,clientId:p.deviceId,releaseVersion:version,runtimeSha256:hashes};
      localStorage.setItem(key,JSON.stringify({request,before:p.clientMaintenance.client,rawPaths:[]}));
      const reload=p.pendingClientReload.io.reload;
      p.pendingClientReload.io.reload=async()=>{const saved=await p.pendingClientReload.io.load(),fixture=JSON.parse(localStorage.getItem(key));fixture.journalAtDispatch=saved;localStorage.setItem(key,JSON.stringify(fixture));return reload();};
      listener=app.vault.on('raw',path=>{if(typeof path==='string'&&(/t-three-code-reload|plugins\/t-three-code\/(?:main.js|manifest.json|styles.css)$/.test(path))){const fixture=JSON.parse(localStorage.getItem(key)||'null');if(fixture){fixture.rawPaths=[...(fixture.rawPaths??[]),path].slice(-12);localStorage.setItem(key,JSON.stringify(fixture));}}});
      await app.vault.adapter.write(files.request,JSON.stringify(request)+'\n');
      const deadline=Date.now()+5000;
      while(Date.now()<deadline){const value=await snapshot();if(value.result?.id===request.id)return value;await new Promise(resolve=>setTimeout(resolve,50));}
      return snapshot();
    },
    snapshot,
    async cleanup(){
      const fixture=JSON.parse(localStorage.getItem(key)||'null');if(!fixture)return {clean:true};
      const p=plugin(),files=paths(fixture.request.clientId);p.pendingClientReload.dispose();
      await p.pendingClientReload.running;
      await p.pendingClientReload.io.save(null);
      for(const file of Object.values(files))if(await app.vault.adapter.exists(file))await app.vault.adapter.remove(file);
      if(listener)app.vault.offref(listener);
      localStorage.removeItem(key);delete globalThis.__t3PendingReloadLab;
      return {clean:!await app.vault.adapter.exists(files.request)&&!await app.vault.adapter.exists(files.result),testNotes:[],testThreads:[]};
    },
  };
  return {installed:true,mobile:app.isMobile};
})();
