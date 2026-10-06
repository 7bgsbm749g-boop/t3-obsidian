import type {App,MarkdownView} from 'obsidian';
import {contentHash} from './completion';
import {nativeResponses} from './native-response-manager';
import {streamBlock} from './stream-block';
import type {CloseStreamBlockCommand} from './response-command';

/** Keep Live Preview's source cursor outside generated history, while native
 * browser selection, links, dropdowns and copy controls continue to work. */
export function installStreamBlockControls(app:App,root:Document,close:(command:CloseStreamBlockCommand)=>Promise<unknown>,icon:(element:HTMLElement,name:string)=>void,onError:(error:unknown)=>void):()=>void {
  const owned=new Map<HTMLElement,HTMLElement>();
  let queued=false,disposed=false;
  const key=(fold:Element)=>fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold;
  const generated=(fold:Element)=>!!key(fold)||!!fold.querySelector(':scope > .callout-title .send-to-t3-inline-spinner');
  const viewFor=(fold:Element)=>app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file&&view.contentEl?.contains(fold));
  const saved=(view:MarkdownView)=>nativeResponses(app).view(view)?.saved()??view.getViewData();
  const refresh=()=>{
    queued=false;if(disposed)return;
    const live=new Set<HTMLElement>();
    for(const fold of Array.from(root.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]'))){
      if(!generated(fold))continue;
      const block=fold.closest<HTMLElement>('.cm-embed-block');if(!block||block.querySelector('.callout')!==fold)continue;
      const actions=block.querySelector<HTMLElement>(':scope > .embed-actions'),native=actions?.querySelector<HTMLElement>('.edit-block-button:not(.send-to-t3-stream-close)');
      if(!actions||!native)continue;
      live.add(actions);actions.classList.add('send-to-t3-stream-actions');
      let button=owned.get(actions);
      if(!button){
        // Clone the native tag and classes, but none of its edit handlers.
        button=native.cloneNode(false) as HTMLElement;button.classList.add('send-to-t3-stream-close');button.setAttribute('role','button');button.tabIndex=0;
        button.setAttribute('aria-label','Remove streaming block');button.setAttribute('title','Remove streaming block');icon(button,'x');actions.appendChild(button);owned.set(actions,button);
        const run=async()=>{
          if(button!.getAttribute('aria-disabled')==='true')return;
          try{
            const current=actions!.closest('.cm-embed-block')?.querySelector('.callout'),id=current&&key(current),view=current&&viewFor(current);
            if(!id||!view?.file)return;
            const found=streamBlock(saved(view),id);if(!found?.complete||found.tracked)return;
            button!.setAttribute('aria-disabled','true');
            await close({version:1,id:crypto.randomUUID(),kind:'close-stream-block',notePath:view.file.path,foldKey:id,hash:contentHash(found.text)});
          }catch(error){onError(error);}finally{button!.removeAttribute('aria-disabled');schedule();}
        };
        button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();void run();});
        button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopImmediatePropagation();void run();}});
      }
      const id=key(fold),view=viewFor(fold);
      let ready=false;try{const found=id&&view?streamBlock(saved(view),id):undefined;ready=!!found?.complete&&!found.tracked;}catch{}
      button.hidden=!ready;
    }
    for(const [actions,button] of owned)if(!live.has(actions)){button.remove();actions.classList.remove('send-to-t3-stream-actions');owned.delete(actions);}
  };
  const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const target=(event:Event)=>{
    const element=event.target instanceof Element?event.target:(event.target as Node)?.parentElement;
    const fold=element?.closest('.callout[data-callout="t3-progress"]');
    return fold&&generated(fold)&&fold.closest('.markdown-source-view.is-live-preview')?{element,fold}:undefined;
  };
  const pointer=(event:Event)=>{if(target(event))event.stopImmediatePropagation();};
  const click=(event:Event)=>{
    const found=target(event);if(!found)return;
    if(found.element?.closest('.callout-title, a, button, input, textarea, select, summary, [role="button"], audio, video'))return;
    event.stopImmediatePropagation();
  };
  // Do not preventDefault: browser drag selection and touch scrolling need it.
  root.addEventListener('pointerdown',pointer,true);root.addEventListener('mousedown',pointer,true);root.addEventListener('click',click,true);
  const observer=new MutationObserver(schedule);observer.observe(root.body,{childList:true,subtree:true});
  const timer=setInterval(refresh,1000);refresh();
  return ()=>{disposed=true;observer.disconnect();clearInterval(timer);root.removeEventListener('pointerdown',pointer,true);root.removeEventListener('mousedown',pointer,true);root.removeEventListener('click',click,true);for(const [actions,button] of owned){button.remove();actions.classList.remove('send-to-t3-stream-actions');}owned.clear();};
}
