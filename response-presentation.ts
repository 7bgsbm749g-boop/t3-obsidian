import type {InlineThreadState} from './inline-thread';
import {reconcileResponseDOM} from './response-dom';

export type IntermediateMode='remove'|'keep'|'collapse';
export type FinalAnswerFormat='formatted'|'raw-markdown';
/** Resolve legacy preferences without changing immutable response requests. */
export function finalAnswerFormat(value:unknown):FinalAnswerFormat {
  return value==='raw-markdown'?'raw-markdown':'formatted';
}
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
export function installResponsePresentation(root:Document,icon?:(element:HTMLElement,name:string)=>void):()=>void {
  const choices=new WeakMap<Element,Map<string,boolean>>();
  const retained=new WeakMap<Element,Map<string,HTMLElement>>();
  const retainedTools=new WeakMap<Element,Map<string,HTMLElement>>();
  const toolChoices=new WeakMap<Element,Map<string,boolean>>();
  const owner=(element:Element)=>element.closest('.workspace-leaf-content')??root.documentElement;
  const key=(element:Element)=>element.querySelector<HTMLElement>('.send-to-t3-fold-key')?.dataset.t3Fold;
  const title=(element:Element)=>element.querySelector<HTMLElement>(':scope > .callout-title');
  const seen=new WeakMap<Element,{heading:HTMLElement;key:string|undefined}>();
  const watched=new Set<Element>(),aligned=new Set<HTMLElement>();
  let restoring=false,queued=false,disposed=false;
  const refresh=()=>{
    queued=false;if(disposed)return;
    const layout=new Set<Element>(),actionsInUse=new Set<HTMLElement>();
    for(const timer of Array.from(root.querySelectorAll<HTMLElement>('.send-to-t3-run-timer[data-t3-start]'))){
      const start=Number(timer.dataset.t3Start),end=timer.dataset.t3End;
      if(!Number.isFinite(start))continue;
      const text=elapsedRun({startedAt:new Date(start).toISOString(),...(end&&Number.isFinite(Number(end))?{finishedAt:new Date(Number(end)).toISOString()}:{})});
      if(timer.textContent!==text)timer.textContent=text;
    }
    for(let fold of Array.from(root.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]'))){
      const id=key(fold),container=owner(fold);
      // Reconcile before the next paint. Only active responses retain ordinary
      // Markdown nodes; native embeds keep their fresh render children.
      if(id?.endsWith(':active')&&fold.isConnected&&typeof fold.replaceWith==='function'){
        const surface=fold.closest('.cm-content, .markdown-preview-view')??container;
        let cache=retained.get(surface);if(!cache){cache=new Map();retained.set(surface,cache);}
        const previous=cache.get(id);
        if(previous&&previous!==fold&&!previous.isConnected){
          const oldTitle=title(previous),newTitle=title(fold),oldContent=previous.querySelector(':scope > .callout-content'),newContent=fold.querySelector(':scope > .callout-content');
          if(oldTitle&&newTitle&&oldContent&&newContent){
            reconcileResponseDOM(oldTitle,newTitle);reconcileResponseDOM(oldContent,newContent);
            fold.replaceWith(previous);fold=previous;
          }
        }
        cache.set(id,fold);if(cache.size>64)cache.delete(cache.keys().next().value!);
      }
      const heading=title(fold);if(!heading)continue;
      heading.setAttribute('role','heading');heading.setAttribute('aria-level','6');
      heading.setAttribute('aria-expanded',String(!fold.classList.contains('is-collapsed')));
      if(id?.endsWith(':active')){
        const choice=choices.get(container)?.get(id);
        if(choice!==undefined)fold.classList.toggle('is-collapsed',!choice);
        const collapsed=fold.classList.contains('is-collapsed');
        heading.setAttribute('aria-expanded',String(!collapsed));
        fold.querySelector('.callout-fold')?.classList.toggle('is-collapsed',collapsed);
        const content=fold.querySelector<HTMLElement>(':scope > .callout-content');
        if(content){content.style.display=collapsed?'none':'';content.style.removeProperty('height');}
      }
      // Native callout titles support pointer input. Also offer keyboard input
      // without changing note bytes or Obsidian's native fold implementation.
      heading.tabIndex=0;
      const block=fold.closest<HTMLElement>('.cm-embed-block');
      // Native callouts live inside a markdown-rendered wrapper. Only the
      // outer callout owns this widget's action; nested examples do not.
      const actions=block?.querySelector('.callout')===fold?block.querySelector<HTMLElement>(':scope > .embed-actions'):undefined;
      if(actions?.querySelector('.edit-block-button')){
        const parent=(actions.offsetParent as HTMLElement|null)??block!;
        layout.add(heading);layout.add(parent);actionsInUse.add(actions);
        const header=heading.getBoundingClientRect(),container=parent.getBoundingClientRect();
        if(header.height>0){
          const center=`${header.top-container.top-parent.clientTop+header.height/2}px`;
          if(actions.style.getPropertyValue('--send-to-t3-header-center')!==center)actions.style.setProperty('--send-to-t3-header-center',center);
          actions.classList.add('send-to-t3-progress-actions');aligned.add(actions);
        }
      }
      const previous=seen.get(fold),fresh=previous?.heading!==heading||previous?.key!==id;
      seen.set(fold,{heading,key:id});
      const expanded=id?(choices.get(owner(fold))?.get(id)??(id.endsWith(':complete')?false:id.endsWith(':active')?true:undefined)):undefined;
      // Restore only newly rendered titles. Native transitions mutate their
      // own DOM; repeatedly clicking a retained/hidden clone can starve both
      // the transition and the editor. Mark it before dispatching the click.
      if(fresh&&expanded!==undefined&&expanded===fold.classList.contains('is-collapsed')){
        restoring=true;try{heading.click();}finally{restoring=false;}
        heading.setAttribute('aria-expanded',String(!fold.classList.contains('is-collapsed')));
      }
    }
    // The current tool group lives below history. Keep its dropdown and result
    // nodes through native renders, and keep user choices when it becomes history.
    for(let group of Array.from(root.querySelectorAll<HTMLElement>('details[data-t3-tool-group]'))){
      const id=group.dataset.t3ToolGroup!;
      const surface=group.closest('.cm-content, .markdown-preview-view')??owner(group);
      let cache=retainedTools.get(surface);if(!cache){cache=new Map();retainedTools.set(surface,cache);}
      const previous=cache.get(id);
      if(previous&&previous!==group&&!previous.isConnected){reconcileResponseDOM(previous,group);group.replaceWith(previous);group=previous;}
      cache.set(id,group);if(cache.size>64)cache.delete(cache.keys().next().value!);
      for(const detail of [group,...Array.from(group.querySelectorAll<HTMLElement>('details[data-t3-tool-key]'))]){
        const detailId=detail.getAttribute('data-t3-tool-group')??detail.getAttribute('data-t3-tool-key');
        const choice=detailId?toolChoices.get(owner(group))?.get(detailId):undefined;
        if(choice!==undefined)detail.toggleAttribute('open',choice);
      }
    }
    if(icon)for(const element of Array.from(root.querySelectorAll<HTMLElement>('[data-t3-tool-icon]')))if(!element.firstChild)icon(element,element.dataset.t3ToolIcon??'wrench');
    // Native HTML blocks outside callouts do not get Obsidian's code-copy
    // processor. Give those exact command/result blocks the same control.
    for(const pre of Array.from(root.querySelectorAll<HTMLElement>('details[data-t3-tool-group] .send-to-t3-tool pre'))){
      if(pre.querySelector('.copy-code-button'))continue;
      const button=root.createElement('button');button.type='button';button.className='copy-code-button send-to-t3-tool-copy';button.textContent='Copy';button.setAttribute('aria-label','Copy code');pre.appendChild(button);
    }
    for(const element of watched)if(!layout.has(element)){resize?.unobserve(element);watched.delete(element);}
    for(const element of layout)if(!watched.has(element)){resize?.observe(element);watched.add(element);}
    for(const actions of aligned)if(!actionsInUse.has(actions)){actions.classList.remove('send-to-t3-progress-actions');actions.style.removeProperty('--send-to-t3-header-center');aligned.delete(actions);}
  };
  const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(schedule);
  const remember=(event:Event)=>{
    if(restoring)return;
    const target=event.target instanceof Element?event.target.closest('.callout-title'):null;
    const fold=target?.closest('.callout[data-callout="t3-progress"]');if(!fold)return;
    const id=key(fold);if(!id)return;
    const container=owner(fold);let saved=choices.get(container);if(!saved){saved=new Map();choices.set(container,saved);}
    const expanded=fold.classList.contains('is-collapsed');saved.set(id,expanded);
    if(id.endsWith(':active')&&typeof fold.classList.toggle==='function'){
      // A retained title no longer belongs to the discarded native render
      // child. Handle its toggle directly, without a transient close animation.
      event.preventDefault();event.stopImmediatePropagation();
      fold.classList.toggle('is-collapsed',!expanded);
      const content=fold.querySelector<HTMLElement>(':scope > .callout-content');
      if(content){content.getAnimations?.().forEach(animation=>animation.cancel());content.style.display=expanded?'':'none';}
      target?.setAttribute('aria-expanded',String(expanded));
    }
    schedule();
  };
  const keyboard=(event:KeyboardEvent)=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const target=event.target as HTMLElement;
    if(target.matches('.callout[data-callout="t3-progress"] > .callout-title')){event.preventDefault();target.click();}
  };
  const rememberTool=(event:Event)=>{
    const detail=event.target as HTMLElement;
    if(!detail.matches?.('details[data-t3-tool-group], details[data-t3-tool-key]')||!detail.isConnected)return;
    const id=detail.getAttribute('data-t3-tool-group')??detail.getAttribute('data-t3-tool-key');if(!id)return;
    const container=owner(detail);let saved=toolChoices.get(container);if(!saved){saved=new Map();toolChoices.set(container,saved);}
    saved.set(id,detail.hasAttribute('open'));
  };
  const copyTool=(event:Event)=>{
    const button=(event.target as Element)?.closest?.('.send-to-t3-tool-copy') as HTMLButtonElement|null;if(!button)return;
    const code=button.closest('pre')?.querySelector('code');if(!code)return;
    event.preventDefault();event.stopPropagation();
    void navigator.clipboard.writeText(code.textContent??'').then(()=>{button.textContent='Copied';},()=>{button.textContent='Copy failed';});
  };
  const click=(event:Event)=>{
    const summary=(event.target as Element)?.closest?.('summary'),detail=summary?.parentElement;
    if(detail?.matches('details[data-t3-tool-group], details[data-t3-tool-key]')){
      // A native editor can replace the HTML widget before the asynchronous
      // toggle event arrives. Record the user's next choice before that render.
      const id=detail.getAttribute('data-t3-tool-group')??detail.getAttribute('data-t3-tool-key')!;
      const container=owner(detail);let saved=toolChoices.get(container);if(!saved){saved=new Map();toolChoices.set(container,saved);}
      const expanded=!detail.hasAttribute('open');saved.set(id,expanded);detail.toggleAttribute('open',expanded);
      event.preventDefault();event.stopImmediatePropagation();return;
    }
    remember(event);copyTool(event);
  };
  const observer=new MutationObserver(records=>{if(records.some(record=>[...Array.from(record.addedNodes),...Array.from(record.removedNodes)].some(node=>node.nodeType===1)))schedule();});
  observer.observe(root.body,{childList:true,subtree:true});
  root.addEventListener('click',click,true);root.addEventListener('keydown',keyboard);root.addEventListener('toggle',rememberTool,true);
  const timer=setInterval(refresh,1000);refresh();
  return ()=>{disposed=true;observer.disconnect();resize?.disconnect();for(const actions of aligned){actions.classList.remove('send-to-t3-progress-actions');actions.style.removeProperty('--send-to-t3-header-center');}clearInterval(timer);root.removeEventListener('click',click,true);root.removeEventListener('keydown',keyboard);root.removeEventListener('toggle',rememberTool,true);};
}
