// EventSource can stop reconnecting after an HTTP error. An observable
// heartbeat also lets the client recover half-open connections after sleep.
export function subscribeToReleases(onVersion:(version:string)=>Promise<boolean>,onUnavailable:()=>void){
  let current:EventSource|undefined;
  let timer:number|undefined;
  let delay=1000;
  let nextFallback=0;
  let unconfirmed='';
  let attempts=0;
  function connect(){
    const source=new EventSource('https://kiri.wtf/t3-obsidian/releases');
    current=source;
    function reconnect(){
      if(current!==source)return;
      current=undefined;
      source.close();
      window.clearTimeout(timer);
      timer=window.setTimeout(connect,delay+Math.random()*delay);
      delay=Math.min(60000,delay*2);
    }
    function disconnected(){
      if(current!==source)return;
      if(Date.now()>=nextFallback){
        nextFallback=Date.now()+6*60*60*1000;
        onUnavailable();
      }
      reconnect();
    }
    function heartbeat(){
      if(current!==source)return;
      window.clearTimeout(timer);
      timer=window.setTimeout(disconnected,75000);
    }
    heartbeat();
    source.addEventListener('heartbeat',heartbeat);
    source.onmessage=event=>{
      if(current!==source||typeof event.data!=='string'||!/^\d+\.\d+\.\d+$/.test(event.data))return;
      heartbeat();
      const version=event.data;
      if(version!==unconfirmed){unconfirmed=version;attempts=0;}
      if(attempts>=3)return;
      attempts++;
      const settled=(verified:boolean)=>{
        if(current!==source||version!==unconfirmed)return;
        if(verified){delay=1000;attempts=0;}
        else if(attempts<3)reconnect();
      };
      void onVersion(version).then(settled,()=>settled(false));
    };
    source.onerror=disconnected;
  }
  connect();
  return ()=>{window.clearTimeout(timer);current?.close();current=undefined;};
}
