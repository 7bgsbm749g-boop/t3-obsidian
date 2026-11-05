import {Platform} from 'obsidian';

// Renderer timers can throttle in a background window. Native timers keep the
// desktop coordinator and lock renewal deadlines while Obsidian is hidden.
export async function desktopTimers(){
  if(Platform.isDesktop){
  const {setInterval,clearInterval,setTimeout}=await import('node:timers');
  return {
    pause:(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds)),
    interval(this:void,callback:()=>void,milliseconds:number):()=>void {
      const timer=setInterval(callback,milliseconds);timer.unref();
      return ()=>clearInterval(timer);
    },
  };
  }
  throw Error('Native coordination timers require desktop Obsidian.');
}
