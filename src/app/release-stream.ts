// EventSource can stop reconnecting after an HTTP error. Reopen the stream
// after a disconnect or a release that GitHub could not yet verify.
export function subscribeToReleases(onVersion:(version:string)=>Promise<boolean>){
  let current:EventSource|undefined;
  let retry:number|undefined;
  let delay=1000;
  function connect(){
    const source=new EventSource('https://kiri.wtf/t3-obsidian/releases');
    current=source;
    function reconnect(){
      if(current!==source)return;
      current=undefined;
      source.close();
      retry=window.setTimeout(connect,delay+Math.random()*delay);
      delay=Math.min(60000,delay*2);
    }
    source.onmessage=event=>{
      if(typeof event.data!=='string'||!/^\d+\.\d+\.\d+$/.test(event.data))return;
      void onVersion(event.data).then(verified=>{
        if(current!==source)return;
        if(verified)delay=1000;
        else reconnect();
      },reconnect);
    };
    source.onerror=reconnect;
  }
  connect();
  return ()=>{window.clearTimeout(retry);current?.close();current=undefined;};
}
