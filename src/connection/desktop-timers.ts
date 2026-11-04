// Browser timers in a background Obsidian renderer can run only once a minute.
// Desktop coordination and lease renewal must keep their normal deadlines.
import {setInterval,clearInterval,setTimeout} from 'node:timers';

export const desktopPause=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));

export function desktopInterval(callback:()=>void,milliseconds:number):()=>void {
  const timer=setInterval(callback,milliseconds);
  timer.unref();
  return ()=>clearInterval(timer);
}
