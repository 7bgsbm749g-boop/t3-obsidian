import type {App,MarkdownView} from 'obsidian';
import {nativeResponses} from './native-response-manager';
import {streamBlock} from './stream-block';
import {removeStreamBlockFromEditor} from './stream-block-edit';
import {responseScrollChanged} from './response-scroll';
import {installResponseDrag} from './response-drag';

/** Keep Live Preview's source cursor outside generated history, while native
 * browser selection, links, dropdowns and copy controls continue to work. */
export function installStreamBlockControls(app:App,root:Document,icon:(element:HTMLElement,name:string)=>void,onError:(error:unknown)=>void):()=>void {
  const stopDrag=installResponseDrag(app,root,icon,onError);
  const owned=new Map<HTMLElement,{close:HTMLElement;follow:HTMLElement;reading:boolean}>();
  const watched=new Set<Element>();
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
      const block=fold.closest<HTMLElement>('.cm-embed-block'),reading=!!fold.closest('.markdown-preview-view');
      if(!reading&&(!block||block.querySelector('.callout')!==fold))continue;
      let actions=reading?fold.querySelector<HTMLElement>(':scope > .send-to-t3-reading-actions'):block!.querySelector<HTMLElement>(':scope > .embed-actions');
      if(reading&&!actions){actions=root.createElement('div');actions.className='send-to-t3-reading-actions';fold.appendChild(actions);}
      const native=actions?.querySelector<HTMLElement>('.edit-block-button:not(.send-to-t3-stream-close):not(.send-to-t3-stream-follow)');
      if(!actions||!reading&&!native)continue;
      live.add(actions);actions.classList.add('send-to-t3-stream-actions');
      let controls=owned.get(actions);
      if(!controls){
        // Clone the native tag and classes, but none of its edit handlers.
        const button=native?native.cloneNode(false) as HTMLElement:root.createElement('div');button.classList.add('edit-block-button','send-to-t3-stream-close');button.setAttribute('role','button');button.tabIndex=0;
        button.setAttribute('aria-label','Remove streaming block');button.setAttribute('title','Remove streaming block');icon(button,'x');actions.appendChild(button);
        const follow=native?native.cloneNode(false) as HTMLElement:root.createElement('div');follow.classList.add('edit-block-button','send-to-t3-stream-follow');follow.setAttribute('role','button');follow.tabIndex=0;icon(follow,'chevrons-down');actions.appendChild(follow);
        controls={close:button,follow,reading};owned.set(actions,controls);
        const run=()=>{
          if(button!.getAttribute('aria-disabled')==='true')return;
          try{
            const current=actions!.closest('.cm-embed-block')?.querySelector('.callout'),id=current&&key(current),view=current&&viewFor(current);
            if(!id||!view?.file)return;
            const found=streamBlock(saved(view),id);if(!found?.complete||found.tracked)return;
            button!.setAttribute('aria-disabled','true');
            removeStreamBlockFromEditor(view,id,saved(view));
          }catch(error){onError(error);}finally{button!.removeAttribute('aria-disabled');schedule();}
        };
        button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();void run();});
        button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopImmediatePropagation();void run();}});
        const toggle=(event:Event)=>{
          event.preventDefault();event.stopImmediatePropagation();if(!event.isTrusted)return;
          const current=reading?actions!.parentElement:actions!.closest('.cm-embed-block')?.querySelector('.callout'),id=current&&key(current),view=current&&viewFor(current);
          if(id&&view)nativeResponses(app).view(view)?.toggleScroll(id);
          refresh();
        };
        follow.addEventListener('click',toggle);
        follow.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')toggle(event);});
      }
      const id=key(fold),view=viewFor(fold);
      let ready=false;try{const found=id&&view?streamBlock(saved(view),id):undefined;ready=!!found?.complete&&!found.tracked;}catch{}
      controls.close.hidden=!ready||reading;
      const state=id&&view?nativeResponses(app).view(view)?.scrollControl(id):undefined;
      controls.follow.hidden=!state;
      const label=state?.active?'Stop following response':'Follow response';
      controls.follow.setAttribute('aria-label',label);controls.follow.setAttribute('title',label);controls.follow.setAttribute('aria-pressed',String(!!state?.active));
      actions.classList.toggle('send-to-t3-stream-actions-bottom',state?.position==='bottom');
      actions.classList.toggle('send-to-t3-stream-actions-active',!!state?.active);
      actions.classList.toggle('send-to-t3-stream-actions-moving',!!state?.moving);
      const heading=fold.querySelector<HTMLElement>(':scope > .callout-title'),parent=(actions.offsetParent as HTMLElement|null)??fold;
      if(heading){
        const header=heading.getBoundingClientRect(),box=fold.getBoundingClientRect(),container=parent.getBoundingClientRect(),edge=header.top+header.height/2-box.top;
        actions.style.setProperty('--send-to-t3-stream-top-center',`${header.top+header.height/2-container.top-parent.clientTop}px`);
        actions.style.setProperty('--send-to-t3-stream-bottom-center',`${box.bottom-edge-container.top-parent.clientTop}px`);
      }
      if(!watched.has(fold)){resize?.observe(fold);watched.add(fold);}
    }
    for(const element of watched)if(!element.isConnected){resize?.unobserve(element);watched.delete(element);}
    for(const [actions,controls] of owned)if(!live.has(actions)){controls.close.remove();controls.follow.remove();actions.classList.remove('send-to-t3-stream-actions','send-to-t3-stream-actions-bottom','send-to-t3-stream-actions-active','send-to-t3-stream-actions-moving');if(controls.reading)actions.remove();owned.delete(actions);}
  };
  const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(schedule);
  const target=(event:Event)=>{
    const element=event.target instanceof Element?event.target:(event.target as Node)?.parentElement;
    const fold=element?.closest('.callout[data-callout="t3-progress"]')??(element?.closest('.send-to-t3-stream-actions')?.closest('.cm-embed-block')?.querySelector('.callout[data-callout="t3-progress"]'));
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
  root.addEventListener(responseScrollChanged,schedule);
  const observer=new MutationObserver(schedule);observer.observe(root.body,{childList:true,subtree:true});
  const timer=setInterval(refresh,1000);refresh();
  return ()=>{disposed=true;stopDrag();observer.disconnect();resize?.disconnect();clearInterval(timer);root.removeEventListener(responseScrollChanged,schedule);root.removeEventListener('pointerdown',pointer,true);root.removeEventListener('mousedown',pointer,true);root.removeEventListener('click',click,true);for(const [actions,controls] of owned){controls.close.remove();controls.follow.remove();actions.classList.remove('send-to-t3-stream-actions','send-to-t3-stream-actions-bottom','send-to-t3-stream-actions-active','send-to-t3-stream-actions-moving');if(controls.reading)actions.remove();}owned.clear();};
}
