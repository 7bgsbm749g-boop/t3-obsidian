export type TimerHandle=number|ReturnType<typeof setTimeout>;
export interface RuntimeClock {
  setTimeout(this:void,callback:()=>void,milliseconds:number):TimerHandle;
  clearTimeout(this:void,handle:TimerHandle|undefined):void;
  setInterval(this:void,callback:()=>void,milliseconds:number):TimerHandle;
  clearInterval(this:void,handle:TimerHandle|undefined):void;
}

// Node-based service tests have no browser window. Resolve their host clock at
// call time so the Node test timer API can control it. Obsidian captures the
// owning window and uses that same owner to schedule and cancel each timer.
const fallback={
  get setTimeout(){return typeof setTimeout==='function'?setTimeout:undefined;},
  get clearTimeout(){return typeof clearTimeout==='function'?clearTimeout:undefined;},
  get setInterval(){return typeof setInterval==='function'?setInterval:undefined;},
  get clearInterval(){return typeof clearInterval==='function'?clearInterval:undefined;},
};
type TimerWindow=Pick<Window,'setTimeout'|'clearTimeout'|'setInterval'|'clearInterval'>;
function createClock(owner?:TimerWindow):RuntimeClock{
  const timeoutWindow=owner&&typeof owner.setTimeout==='function'&&typeof owner.clearTimeout==='function'?owner:undefined;
  const intervalWindow=owner&&typeof owner.setInterval==='function'&&typeof owner.clearInterval==='function'?owner:undefined;
  return {
    setTimeout(callback,milliseconds){
      if(timeoutWindow)return timeoutWindow.setTimeout(callback,milliseconds);
      if(!fallback.setTimeout)throw Error('The runtime timeout clock is unavailable.');
      return fallback.setTimeout(callback,milliseconds);
    },
    clearTimeout(handle){
      if(timeoutWindow&&typeof handle==='number')timeoutWindow.clearTimeout(handle);
      else fallback.clearTimeout?.(handle);
    },
    setInterval(callback,milliseconds){
      if(intervalWindow)return intervalWindow.setInterval(callback,milliseconds);
      if(!fallback.setInterval)throw Error('The runtime interval clock is unavailable.');
      return fallback.setInterval(callback,milliseconds);
    },
    clearInterval(handle){
      if(intervalWindow&&typeof handle==='number')intervalWindow.clearInterval(handle);
      else fallback.clearInterval?.(handle);
    },
  };
}
export const serviceClock=createClock(typeof window==='undefined'?undefined:window);
export const scheduleTimeout=serviceClock.setTimeout,cancelTimeout=serviceClock.clearTimeout;
export const scheduleInterval=serviceClock.setInterval,cancelInterval=serviceClock.clearInterval;
export function clockForDocument(document?:Document):RuntimeClock{
  return document?.defaultView?createClock(document.defaultView):serviceClock;
}
