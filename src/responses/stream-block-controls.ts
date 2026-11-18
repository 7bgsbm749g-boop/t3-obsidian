import {responseControlsChanged} from './response-controls-event';
import type {App,MarkdownView} from 'obsidian';
import {nativeResponses} from './native-response-manager';
import {streamBlock,streamBlockIndex} from './stream-block';
import {removeStreamBlockFromEditor} from './stream-block-edit';
import {responseScrollChanged} from './response-scroll';
import {installResponseDrag} from './response-drag';
import {installStreamStopControls} from './stream-stop-control';

/** Keep Live Preview's source cursor outside generated history, while native
 * browser selection, links, dropdowns and copy controls continue to work. */
export function installStreamBlockControls(app:App,root:Document,icon:(element:HTMLElement,name:string)=>void,onError:(error:unknown)=>void,onSignIn:()=>void=()=>{},onStop?:(id:string,view:MarkdownView)=>Promise<void>):()=>void {
  const stopDrag=installResponseDrag(app,root,icon,onError);
  const owned=new Map<HTMLElement,{close:HTMLElement;follow:HTMLElement;signIn:HTMLButtonElement;reading:boolean;fold:HTMLElement;footer?:HTMLElement}>();
  const watched=new Map<Element,HTMLElement>();
  const dirtyLayout=new WeakSet<HTMLElement>();
  const layouts=new WeakMap<HTMLElement,{fold:HTMLElement;heading:HTMLElement;footer?:HTMLElement;bottom:boolean;collapsed:boolean;buttons:number}>();
  const setPx=(element:HTMLElement,property:string,value:number)=>{
    const px=`${value}px`;
    if(element.style.getPropertyValue(property)!==px)element.style.setProperty(property,px);
  };
  let queued=false,disposed=false;
  const key=(fold:Element)=>fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold;
  const generated=(fold:Element)=>!!key(fold)||!!fold.querySelector(':scope > .callout-title .send-to-t3-inline-spinner');
  const viewFor=(fold:Element)=>app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file&&view.contentEl?.contains(fold));
  const saved=(view:MarkdownView)=>nativeResponses(app).view(view)?.saved()??view.getViewData();
  const stopControls=onStop?installStreamStopControls(root,fold=>{
    const block=fold.closest('.cm-embed-block'),reading=!!fold.closest('.markdown-preview-view');
    if(!reading&&(!block||block.querySelector('.callout')!==fold))return;
    const foldKey=key(fold),view=viewFor(fold),id=foldKey&&view&&nativeResponses(app).view(view)?.stopControl(foldKey);
    return id&&view&&foldKey?{id,key:foldKey,view}:undefined;
  },target=>onStop(target.id,target.view),icon,onError):()=>{};
  const refresh=()=>{
    queued=false;if(disposed)return;
    const live=new Set<HTMLElement>(),targets=new Map<Element,HTMLElement>();
    const measure:Array<{actions:HTMLElement;fold:HTMLElement;heading:HTMLElement;footer?:HTMLElement;bottom:boolean}>=[];
    const indexes=new Map<MarkdownView,ReturnType<typeof streamBlockIndex>>();
    const indexFor=(view:MarkdownView)=>{
      let index=indexes.get(view);
      if(!index){
        index=streamBlockIndex(view.editor.getValue());
        indexes.set(view,index);
      }
      return index;
    };
    for(const fold of Array.from(root.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]'))){
      if(!generated(fold))continue;
      const block=fold.closest<HTMLElement>('.cm-embed-block'),reading=!!fold.closest('.markdown-preview-view');
      if(!reading&&(!block||block.querySelector('.callout')!==fold))continue;
      let actions=reading?fold.querySelector<HTMLElement>(':scope > .send-to-t3-reading-actions'):block!.querySelector<HTMLElement>(':scope > .embed-actions');
      if(reading)fold.classList.add('send-to-t3-has-reading-actions');
      block?.classList.toggle('send-to-t3-stream-collapsed',fold.classList.contains('is-collapsed'));
      if(reading&&!actions){actions=root.win.createDiv();actions.className='send-to-t3-reading-actions';fold.appendChild(actions);}
      const native=actions?.querySelector<HTMLElement>('.edit-block-button:not(.send-to-t3-stream-close):not(.send-to-t3-stream-follow):not(.send-to-t3-stream-sign-in)');
      if(!actions||!reading&&!native)continue;
      live.add(actions);actions.classList.add('send-to-t3-stream-actions');
      let controls=owned.get(actions);
      if(!controls){
        // Clone the native tag and classes, but none of its edit handlers.
        const button=native?native.cloneNode(false) as HTMLElement:root.win.createDiv();button.classList.add('edit-block-button','send-to-t3-stream-close');button.setAttribute('role','button');button.tabIndex=0;
        button.setAttribute('aria-label','Remove streaming block');button.setAttribute('title','Remove streaming block');icon(button,'x');actions.appendChild(button);
        const follow=native?native.cloneNode(false) as HTMLElement:root.win.createDiv();follow.classList.add('edit-block-button','send-to-t3-stream-follow');follow.setAttribute('role','button');follow.tabIndex=0;icon(follow,'chevrons-down');actions.appendChild(follow);
        const signIn=root.win.createEl('button');signIn.type='button';signIn.className='send-to-t3-stream-sign-in';signIn.textContent='Sign in';signIn.setAttribute('aria-label','Sign in to T3 to resume this response');actions.appendChild(signIn);
        signIn.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();onSignIn();});
        controls={close:button,follow,signIn,reading,fold};owned.set(actions,controls);
        const run=()=>{
          if(button.getAttribute('aria-disabled')==='true')return;
          try{
            const current=actions.closest('.cm-embed-block')?.querySelector('.callout'),id=current&&key(current),view=current&&viewFor(current);
            if(!id||!view?.file)return;
            const found=streamBlock(saved(view),id);if(!found?.complete||found.tracked)return;
            button.setAttribute('aria-disabled','true');
            removeStreamBlockFromEditor(view,id,saved(view));
          }catch(error){onError(error);}finally{button.removeAttribute('aria-disabled');schedule();}
        };
        button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();void run();});
        button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopImmediatePropagation();void run();}});
        const toggle=(event:Event)=>{
          event.preventDefault();event.stopImmediatePropagation();if(!event.isTrusted)return;
          const current=reading?actions.parentElement:actions.closest('.cm-embed-block')?.querySelector('.callout'),id=current&&key(current),view=current&&viewFor(current);
          if(id&&view)nativeResponses(app).view(view)?.toggleScroll(id);
          refresh();
        };
        follow.addEventListener('click',toggle);
        follow.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')toggle(event);});
      }
      if(controls.fold!==fold){controls.footer?.classList.remove('send-to-t3-stream-footer');controls.fold.style.removeProperty('--send-to-t3-stream-footer-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-footer');controls.fold=fold;}
      const id=key(fold),view=viewFor(fold);
      // This is only a visibility hint. Use the compact native document for
      // it; the click handler above rechecks canonical saved bytes before any
      // destructive action. Layout must not repeatedly parse hidden output.
      let ready=false;try{const found=id&&view&&!reading&&view.getMode()==='source'?indexFor(view).get(id):undefined;ready=!!found?.complete&&!found.tracked;}catch{/* An unparseable saved block exposes no destructive action. */}
      const response=id&&view?nativeResponses(app).view(view)?.responseForFold(id):undefined;
      const needsSignIn=!!response&&nativeResponses(app).connectionIssue(response)?.kind==='sign-in-required';
      controls.signIn.hidden=!needsSignIn;actions.classList.toggle('send-to-t3-stream-auth-required',needsSignIn);
      controls.close.hidden=!ready||reading||needsSignIn;
      const state=id&&view?nativeResponses(app).view(view)?.scrollControl(id):undefined;
      controls.follow.hidden=!state||needsSignIn||fold.classList.contains('is-collapsed');
      const label=state?.active?'Stop following response':'Follow response';
      controls.follow.setAttribute('aria-label',label);controls.follow.setAttribute('title',label);controls.follow.setAttribute('aria-pressed',String(!!state?.active));
      const bottom=!controls.follow.hidden;
      // Share the final activity line instead of adding another line beneath
      // it. Native Markdown wraps a status span in a paragraph.
      const content=fold.querySelector<HTMLElement>(':scope > .callout-content');
      const last=content?.lastElementChild as HTMLElement|null|undefined;
      const footer=bottom&&last&&(last.matches('.send-to-t3-response-activity, .send-to-t3-context')||last.querySelector('.send-to-t3-response-activity, .send-to-t3-context'))?last:undefined;
      if(controls.footer!==footer){controls.footer?.classList.remove('send-to-t3-stream-footer');controls.footer=footer;}
      footer?.classList.add('send-to-t3-stream-footer');
      actions.classList.toggle('send-to-t3-stream-actions-bottom',bottom);
      actions.classList.toggle('send-to-t3-stream-actions-active',!!state?.active);
      const heading=fold.querySelector<HTMLElement>(':scope > .callout-title');
      if(!heading)continue;
      for(const element of [actions,fold,heading,footer])if(element)targets.set(element,actions);
      const collapsed=fold.classList.contains('is-collapsed');
      const buttons=Number(ready)+2*Number(needsSignIn);
      const previous=layouts.get(actions);
      if(!previous||previous.fold!==fold||previous.heading!==heading||previous.footer!==footer||
          previous.bottom!==bottom||previous.collapsed!==collapsed||previous.buttons!==buttons||dirtyLayout.has(actions)){
        measure.push({actions,fold,heading,footer,bottom});
        layouts.set(actions,{fold,heading,footer,bottom,collapsed,buttons});
        dirtyLayout.delete(actions);
      }
    }
    for(const element of watched.keys())if(!targets.has(element)){resize?.unobserve(element);watched.delete(element);}
    for(const [element,actions] of targets){
      if(!watched.has(element))resize?.observe(element);
      watched.set(element,actions);
    }
    for(const [actions,controls] of owned)if(!live.has(actions)){controls.close.remove();controls.follow.remove();controls.signIn.remove();controls.footer?.classList.remove('send-to-t3-stream-footer');controls.fold.style.removeProperty('--send-to-t3-stream-footer-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-footer');actions.classList.remove('send-to-t3-stream-actions','send-to-t3-stream-actions-bottom','send-to-t3-stream-actions-active','send-to-t3-stream-actions-moving','send-to-t3-stream-auth-required');if(controls.reading){actions.parentElement?.classList.remove('send-to-t3-has-reading-actions');actions.remove();}actions.closest('.cm-embed-block')?.classList.remove('send-to-t3-stream-collapsed');owned.delete(actions);layouts.delete(actions);}

    // Apply spacing across the affected toolbars before measuring wrapped
    // headings or footer rows. Keep each group of reads free of style writes.
    const sizes=measure.map(item=>({...item,toolbar:item.actions.getBoundingClientRect()}));
    for(const {fold,footer,bottom,toolbar} of sizes){
      setPx(fold,'--send-to-t3-stream-actions-space',!bottom&&toolbar.width>0?toolbar.width+8:0);
      setPx(fold,'--send-to-t3-stream-actions-footer',bottom&&!footer?toolbar.height+8:0);
      setPx(fold,'--send-to-t3-stream-footer-space',bottom?toolbar.width+8:0);
    }
    const centers=sizes.map(({actions,fold,heading,footer,bottom,toolbar})=>{
      const parent=(actions.offsetParent as HTMLElement|null)??fold;
      const header=heading.getBoundingClientRect(),box=fold.getBoundingClientRect();
      const container=parent.getBoundingClientRect(),row=footer?.getBoundingClientRect();
      const origin=container.top+parent.clientTop,top=header.top+header.height/2;
      return {actions,top:top-origin,bottom:(row?row.top+row.height/2:box.bottom-(bottom?toolbar.height/2+4:top-box.top))-origin};
    });
    for(const {actions,top,bottom} of centers){
      setPx(actions,'--send-to-t3-stream-top-center',top);
      setPx(actions,'--send-to-t3-stream-bottom-center',bottom);
    }
  };
  const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(entries=>{
    for(const {target} of entries){
      const actions=watched.get(target);
      if(actions)dirtyLayout.add(actions);
    }
    schedule();
  });
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
  const observer=new MutationObserver(records=>{if(records.some(record=>record.type==='childList'||record.target.instanceOf(Element)&&record.target.matches('.callout[data-callout="t3-progress"]')&&((record.oldValue??'').split(/\s+/).includes('is-collapsed')!==record.target.classList.contains('is-collapsed'))))schedule();});observer.observe(root.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class'],attributeOldValue:true});
  root.addEventListener(responseControlsChanged,schedule);
  refresh();
  return ()=>{disposed=true;root.removeEventListener(responseControlsChanged,schedule);stopControls();stopDrag();observer.disconnect();resize?.disconnect();root.removeEventListener(responseScrollChanged,schedule);root.removeEventListener('pointerdown',pointer,true);root.removeEventListener('mousedown',pointer,true);root.removeEventListener('click',click,true);for(const [actions,controls] of owned){controls.close.remove();controls.follow.remove();controls.signIn.remove();controls.footer?.classList.remove('send-to-t3-stream-footer');controls.fold.style.removeProperty('--send-to-t3-stream-footer-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-footer');actions.classList.remove('send-to-t3-stream-actions','send-to-t3-stream-actions-bottom','send-to-t3-stream-actions-active','send-to-t3-stream-actions-moving','send-to-t3-stream-auth-required');if(controls.reading){actions.parentElement?.classList.remove('send-to-t3-has-reading-actions');actions.remove();}actions.closest('.cm-embed-block')?.classList.remove('send-to-t3-stream-collapsed');}owned.clear();};
}
