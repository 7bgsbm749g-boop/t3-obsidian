import type {MarkdownView} from 'obsidian';

export interface StreamStopTarget {id:string;key:string;view:MarkdownView}

/** UI state belongs to a response in a pane, never to note Markdown. Resolve
 * again at activation: a retained DOM node can outlive the run it displayed. */
export function installStreamStopControls(root:Document,resolve:(fold:HTMLElement)=>StreamStopTarget|undefined,stop:(target:StreamStopTarget)=>Promise<void>,icon:(element:HTMLElement,name:string)=>void,onError:(error:unknown)=>void):()=>void {
  const controls=new Map<HTMLElement,HTMLButtonElement>(),revealed=new WeakMap<MarkdownView,Set<string>>(),pending=new Set<string>();
  let disposed=false,queued=false;
  const identity=(target:StreamStopTarget)=>JSON.stringify([target.id,target.key]);
  const shown=(target:StreamStopTarget)=>revealed.get(target.view)?.has(identity(target))===true;
  const refresh=()=>{
    queued=false;if(disposed)return;
    const live=new Set<HTMLElement>();
    for(const fold of Array.from(root.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]'))){
      const target=resolve(fold);if(!target)continue;
      live.add(fold);fold.classList.add('send-to-t3-stream-stoppable');
      let button=controls.get(fold);
      if(!button){
        button=root.createElement('button');button.type='button';button.className='send-to-t3-stream-stop';button.hidden=true;
        button.setAttribute('aria-label','Stop T3 response');button.setAttribute('title','Stop T3 response');icon(button,'square');
        controls.set(fold,button);
      }
      // Native rendering can replace children while retaining the callout.
      if(button.parentElement!==fold)fold.appendChild(button);
      button.hidden=!shown(target);button.disabled=pending.has(target.id);
      button.setAttribute('aria-busy',String(button.disabled));
    }
    for(const [fold,button] of controls)if(!live.has(fold)){button.remove();fold.classList.remove('send-to-t3-stream-stoppable');controls.delete(fold);}
  };
  const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const find=(event:Event)=>{
    let fold=(event.target as Element)?.closest?.<HTMLElement>('.callout[data-callout="t3-progress"]');
    while(fold&&!controls.has(fold))fold=fold.parentElement?.closest<HTMLElement>('.callout[data-callout="t3-progress"]')??null;
    return fold??undefined;
  };
  const reveal=(event:Event)=>{
    const fold=find(event),target=fold&&resolve(fold);if(!target)return;
    let keys=revealed.get(target.view);if(!keys){keys=new Set();revealed.set(target.view,keys);}
    keys.add(identity(target));refresh();
  };
  const click=(event:Event)=>{
    const button=(event.target as Element)?.closest?.<HTMLButtonElement>('.send-to-t3-stream-stop');
    if(!button){reveal(event);return;}
    const fold=button.parentElement;if(!fold||controls.get(fold)!==button)return;
    event.preventDefault();event.stopImmediatePropagation();
    const target=resolve(fold);
    if(!target||!shown(target)||button.hidden||pending.has(target.id)){refresh();return;}
    pending.add(target.id);refresh();
    void Promise.resolve().then(()=>{
      const current=resolve(fold);
      if(!disposed&&current&&current.view===target.view&&identity(current)===identity(target))return stop(target);
    }).catch(onError).finally(()=>{pending.delete(target.id);refresh();});
  };
  // Reveal after a tap resolves its target. Inserting a control on pointerdown
  // could turn the first tap at the top right into an accidental Stop.
  // Do not cancel selection, link navigation, title folding or touch scrolling.
  root.addEventListener('click',click,true);root.addEventListener('focusin',reveal,true);
  const observer=new MutationObserver(schedule);observer.observe(root.body,{childList:true,subtree:true});
  const timer=setInterval(refresh,1000);refresh();
  return ()=>{disposed=true;observer.disconnect();clearInterval(timer);root.removeEventListener('click',click,true);root.removeEventListener('focusin',reveal,true);for(const [fold,button] of controls){button.remove();fold.classList.remove('send-to-t3-stream-stoppable');}controls.clear();};
}
