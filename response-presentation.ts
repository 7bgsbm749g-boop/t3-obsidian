import type {InlineThreadState} from './inline-thread';

export type IntermediateMode='remove'|'keep'|'collapse';
/** Old saved responses keep their original boolean preference. */
export function intermediateMode(value:unknown,legacy?:boolean):IntermediateMode {
  return value==='collapse'||value==='keep'||value==='remove'?value:value===true||legacy===true?'keep':'remove';
}
export interface RunTiming {startedAt:string;finishedAt?:string}
export function elapsedRun(timing:RunTiming,now=Date.now()):string {
  const start=Date.parse(timing.startedAt),end=timing.finishedAt?Date.parse(timing.finishedAt):now;
  const seconds=Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,Math.floor((end-start)/1000)):0;
  const parts=[Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0'));
  if(seconds>=3600)parts.unshift(String(Math.floor(seconds/3600)).padStart(2,'0'));
  return parts.join(':');
}
export function runTimer(timing:RunTiming):string {
  const start=Date.parse(timing.startedAt),end=Date.parse(timing.finishedAt??'');
  if(!Number.isFinite(start))return '';
  // Active Markdown bytes never depend on the clock. Each client updates its
  // own DOM; terminal timestamps freeze both Markdown and the displayed timer.
  return `<span class="send-to-t3-run-timer" data-t3-start="${start}"${Number.isFinite(end)?` data-t3-end="${end}"`:''} aria-label="Elapsed run time">${elapsedRun(timing, start)}</span>`;
}
export function completionTime(state:InlineThreadState,turnId:string):string {
  const turn=state.latestTurn?.turnId===turnId?state.latestTurn:state.turns?.[turnId];
  const completedAt=turn?.completedAt??state.checkpoints?.find(item=>item.turnId===turnId&&item.status==='ready')?.completedAt;
  return completedAt&&Number.isFinite(Date.parse(completedAt))?completedAt:new Date().toISOString();
}

/** Native callouts give editor, reading view and mobile the same bounded fold.
 * Retain explicit user choices when streaming replaces a callout's DOM. */
export function installResponsePresentation(root:Document):()=>void {
  const choices=new WeakMap<Element,Map<string,boolean>>();
  const owner=(element:Element)=>element.closest('.workspace-leaf-content')??root.documentElement;
  const key=(element:Element)=>element.querySelector<HTMLElement>('.send-to-t3-fold-key')?.dataset.t3Fold;
  const title=(element:Element)=>element.querySelector<HTMLElement>(':scope > .callout-title');
  const seen=new WeakMap<Element,{heading:HTMLElement;key:string|undefined}>();
  let restoring=false,queued:ReturnType<typeof setTimeout>|undefined,disposed=false;
  const refresh=()=>{
    queued=undefined;if(disposed)return;
    for(const timer of Array.from(root.querySelectorAll<HTMLElement>('.send-to-t3-run-timer[data-t3-start]'))){
      const start=Number(timer.dataset.t3Start),end=timer.dataset.t3End;
      if(!Number.isFinite(start))continue;
      const text=elapsedRun({startedAt:new Date(start).toISOString(),...(end&&Number.isFinite(Number(end))?{finishedAt:new Date(Number(end)).toISOString()}:{})});
      if(timer.textContent!==text)timer.textContent=text;
    }
    for(const fold of Array.from(root.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]'))){
      const heading=title(fold);if(!heading)continue;
      heading.setAttribute('role','heading');heading.setAttribute('aria-level','6');
      heading.setAttribute('aria-expanded',String(!fold.classList.contains('is-collapsed')));
      // Native callout titles support pointer input. Also offer keyboard input
      // without changing note bytes or Obsidian's native fold implementation.
      heading.tabIndex=0;
      const id=key(fold),previous=seen.get(fold),fresh=previous?.heading!==heading||previous?.key!==id;
      seen.set(fold,{heading,key:id});
      const expanded=id?choices.get(owner(fold))?.get(id):undefined;
      // Restore only newly rendered titles. Native transitions mutate their
      // own DOM; repeatedly clicking a retained/hidden clone can starve both
      // the transition and the editor. Mark it before dispatching the click.
      if(fresh&&expanded!==undefined&&expanded===fold.classList.contains('is-collapsed')){
        restoring=true;try{heading.click();}finally{restoring=false;}
        heading.setAttribute('aria-expanded',String(!fold.classList.contains('is-collapsed')));
      }
    }
  };
  const schedule=()=>{if(queued===undefined&&!disposed)queued=setTimeout(refresh,0);};
  const remember=(event:Event)=>{
    if(restoring)return;
    const target=event.target instanceof Element?event.target.closest('.callout-title'):null;
    const fold=target?.closest('.callout[data-callout="t3-progress"]');if(!fold)return;
    const id=key(fold);if(!id)return;
    const container=owner(fold);let saved=choices.get(container);if(!saved){saved=new Map();choices.set(container,saved);}
    saved.set(id,fold.classList.contains('is-collapsed'));schedule();
  };
  const keyboard=(event:KeyboardEvent)=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const target=event.target as HTMLElement;
    if(target.matches('.callout[data-callout="t3-progress"] > .callout-title')){event.preventDefault();target.click();}
  };
  const observer=new MutationObserver(records=>{if(records.some(record=>[...Array.from(record.addedNodes),...Array.from(record.removedNodes)].some(node=>node.nodeType===1)))schedule();});
  observer.observe(root.body,{childList:true,subtree:true});
  root.addEventListener('click',remember,true);root.addEventListener('keydown',keyboard);
  const timer=setInterval(refresh,1000);refresh();
  return ()=>{disposed=true;observer.disconnect();if(queued!==undefined)clearTimeout(queued);clearInterval(timer);root.removeEventListener('click',remember,true);root.removeEventListener('keydown',keyboard);};
}
