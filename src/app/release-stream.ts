// EventSource can stop reconnecting after an HTTP error. An observable
// heartbeat also lets the client recover half-open connections after sleep.
export function subscribeToReleases(onVersion:(version:string)=>Promise<boolean>,onUnavailable:()=>void){
  let current:EventSource|undefined;
  let timer:number|undefined;
  let delay=1000;
  let nextFallback=0;
  let announced='';
  let retryIndex=0;
  let retryAt=Infinity;
  let pending:Promise<boolean>|undefined;
  const verificationDelays=[75000,300000,6*60*60*1000];
  function connect(){
    const source=new EventSource('https://kiri.wtf/t3-obsidian/releases');
    current=source;
    let receivedVersion='';
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
    function verify(version:string){
      // Keep the stream open while GitHub refreshes its release metadata.
      retryAt=Infinity;
      const check=onVersion(version);
      pending=check;
      const settled=(verified:boolean)=>{
        if(check!==pending||version!==announced)return;
        pending=undefined;
        if(verified){delay=1000;retryIndex=0;}
        else{
          retryAt=Date.now()+verificationDelays[retryIndex];
          retryIndex=Math.min(retryIndex+1,verificationDelays.length-1);
        }
      };
      void check.then(settled,()=>settled(false));
    }
    source.addEventListener('heartbeat',()=>{
      heartbeat();
      if(current===source&&Date.now()>=retryAt)verify(announced);
    });
    source.onmessage=event=>{
      if(current!==source||typeof event.data!=='string'||!/^\d+\.\d+\.\d+$/.test(event.data))return;
      heartbeat();
      const replay=event.data!==receivedVersion;
      receivedVersion=event.data;
      if(event.data===announced){
        if(pending)return;
        if(retryAt===Infinity?!replay:Date.now()<retryAt)return;
      }
      if(announced!==event.data)retryIndex=0;
      announced=event.data;
      verify(announced);
    };
    source.onerror=disconnected;
  }
  connect();
  return ()=>{window.clearTimeout(timer);current?.close();current=undefined;};
}
