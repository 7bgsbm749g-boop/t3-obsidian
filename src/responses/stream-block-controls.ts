import {responseControlsChanged} from './response-controls-event';
import type {App,MarkdownView} from 'obsidian';
import {nativeResponses} from './native-response-manager';
import {streamBlock,streamBlockIndex} from './stream-block';
import {removeStreamBlockFromEditor} from './stream-block-edit';
import {responseScrollChanged} from './response-scroll';
import {installResponseDrag} from './response-drag';
import {installStreamStopControls} from './stream-stop-control';
import {editorCM} from '../shared/native-editor';
import {observeDocumentChanges,closestWhere,isEmbedBlock,isProgressFold,isReadingView,type DomBatch} from '../ui/dom-changes';

const PROGRESS='.callout[data-callout="t3-progress"]';

/** Keep Live Preview's source cursor outside generated history, while native
 * browser selection, links, dropdowns and copy controls continue to work. */
export function installStreamBlockControls(app:App,root:Document,icon:(element:HTMLElement,name:string)=>void,onError:(error:unknown)=>void,onSignIn:()=>void=()=>{},onStop?:(id:string,view:MarkdownView)=>Promise<void>):()=>void {
  const stopDrag=installResponseDrag(app,root,icon,onError);
  const owned=new Map<HTMLElement,{close:HTMLElement;follow:HTMLElement;signIn:HTMLButtonElement;reading:boolean;fold:HTMLElement;footer?:HTMLElement}>();
  const watched=new Map<Element,HTMLElement>();
  const layouts=new WeakMap<HTMLElement,{fold:HTMLElement;heading:HTMLElement;footer?:HTMLElement;bottom:boolean;collapsed:boolean;buttons:number}>();
  const setPx=(element:HTMLElement,property:string,value:number)=>{
    const px=`${value}px`;
    if(element.style.getPropertyValue(property)!==px)element.style.setProperty(property,px);
  };
  let queued=false,disposed=false;
  // Cache each fold's key element. Its attribute is read on every call, and
  // the cache holds only while it is still inside the fold's own title.
  const keys=new WeakMap<Element,{title:Element;element:HTMLElement}>();
  const key=(fold:Element)=>{
    const cached=keys.get(fold);
    if(cached&&cached.title.parentElement===fold&&cached.title.contains(cached.element))return cached.element.dataset.t3Fold;
    const element=fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key'),title=element?.closest('.callout-title');
    if(element&&title)keys.set(fold,{title,element});else keys.delete(fold);
    return element?.dataset.t3Fold;
  };
  const generated=(fold:Element)=>!!key(fold)||!!fold.querySelector(':scope > .callout-title .send-to-t3-inline-spinner');
  const viewFor=(fold:Element)=>app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file&&view.contentEl?.contains(fold));
  const saved=(view:MarkdownView)=>nativeResponses(app).view(view)?.saved()??view.getViewData();
  const stopControls=onStop?installStreamStopControls(root,fold=>{
    const block=fold.closest('.cm-embed-block'),reading=!!fold.closest('.markdown-preview-view');
    if(!reading&&(!block||block.querySelector('.callout')!==fold))return;
    const foldKey=key(fold),view=viewFor(fold),id=foldKey&&view&&nativeResponses(app).view(view)?.stopControl(foldKey);
    return id&&view&&foldKey?{id,key:foldKey,view}:undefined;
  },target=>onStop(target.id,target.view),icon,onError):()=>{};
  // Editor documents are immutable, so one index serves every pass until the
  // next edit. Other modes index their text once per pass.
  const documentIndexes=new WeakMap<object,ReturnType<typeof streamBlockIndex>>(),lastIndexes=new WeakMap<MarkdownView,object>();
  // A full pass rescans the document; otherwise only the folds that changes
  // added, removed or changed are processed.
  let full=true;const pending=new Set<HTMLElement>(),touched=new Set<HTMLElement>();
  const observedBy=new Map<HTMLElement,Element[]>();
  type Measure={actions:HTMLElement;fold:HTMLElement;heading:HTMLElement;footer?:HTMLElement;bottom:boolean};
  const awaitingLayout=new Set<HTMLElement>();
  const release=(actions:HTMLElement)=>{for(const element of observedBy.get(actions)??[]){resize?.unobserve(element);watched.delete(element);}observedBy.delete(actions);awaitingLayout.delete(actions);};
  const refresh=()=>{
    queued=false;if(disposed)return;
    const everything=full,candidates=everything?Array.from(root.querySelectorAll<HTMLElement>(PROGRESS)):[...pending].filter(fold=>fold.isConnected),changedActions=new Set(touched);
    full=false;pending.clear();touched.clear();
    const live=new Set<HTMLElement>();
    const measure:Measure[]=[];
    const indexes=new Map<MarkdownView,ReturnType<typeof streamBlockIndex>>();let rescan=false;
    const indexFor=(view:MarkdownView)=>{
      const doc=editorCM(view.editor)?.state?.doc;
      let index=doc?documentIndexes.get(doc):indexes.get(view);
      if(!index){
        index=streamBlockIndex(view.editor.getValue());
        if(doc)documentIndexes.set(doc,index);else indexes.set(view,index);
      }
      // An edit can change other mounted streams too (a pasted duplicate
      // makes a key ambiguous). The first scoped pass after it rescans.
      const previous=lastIndexes.get(view);if(previous&&previous!==index&&!everything)rescan=true;lastIndexes.set(view,index);
      return index;
    };
    for(const fold of candidates){
      const block=closestWhere(fold,isEmbedBlock) as HTMLElement|null,reading=!!closestWhere(fold,isReadingView);
      if(!reading&&(!block||block.querySelector('.callout')!==fold))continue;
      const existing=reading?fold.querySelector<HTMLElement>(':scope > .send-to-t3-reading-actions'):block!.querySelector<HTMLElement>(':scope > .embed-actions');
      if(existing)changedActions.add(existing);
      if(!generated(fold))continue;
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
          full=true;refresh();
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
      const targets:Element[]=[actions,fold,heading,...footer?[footer]:[]],previousTargets=observedBy.get(actions)??[];
      for(const element of previousTargets)if(!targets.includes(element)){resize?.unobserve(element);watched.delete(element);}
      for(const element of targets){if(!watched.has(element))resize?.observe(element);watched.set(element,actions);}
      observedBy.set(actions,targets);
      const collapsed=fold.classList.contains('is-collapsed');
      const buttons=Number(ready)+2*Number(needsSignIn);
      const previous=layouts.get(actions);
      if(!previous||previous.fold!==fold||previous.heading!==heading||previous.footer!==footer||
          previous.bottom!==bottom||previous.collapsed!==collapsed||previous.buttons!==buttons){
        measure.push({actions,fold,heading,footer,bottom});
        layouts.set(actions,{fold,heading,footer,bottom,collapsed,buttons});
      }
    }
    // A scoped pass releases controls whose block left, lost its fold, or
    // was processed without becoming a generated stream again.
    for(const [actions,controls] of owned)if(!live.has(actions)&&(everything||!actions.isConnected||!controls.fold.isConnected||changedActions.has(actions))){release(actions);controls.close.remove();controls.follow.remove();controls.signIn.remove();controls.footer?.classList.remove('send-to-t3-stream-footer');controls.fold.style.removeProperty('--send-to-t3-stream-footer-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-footer');actions.classList.remove('send-to-t3-stream-actions','send-to-t3-stream-actions-bottom','send-to-t3-stream-actions-active','send-to-t3-stream-actions-moving','send-to-t3-stream-auth-required');if(controls.reading){actions.parentElement?.classList.remove('send-to-t3-has-reading-actions');actions.remove();}actions.closest('.cm-embed-block')?.classList.remove('send-to-t3-stream-collapsed');owned.delete(actions);layouts.delete(actions);}

    if(everything)for(const actions of [...observedBy.keys()])if(!owned.has(actions))release(actions);
    if(rescan)schedule();
    if(resize){
      // Measure after the browser's own layout, in the resize callback, rather
      // than forcing layout after this pass's writes. Re-observing a toolbar
      // delivers a notification even when its size did not change.
      // A toolbar whose controls all hid is 0x0 and gets no notification;
      // its rendered fold always does.
      for(const {actions,fold} of measure){awaitingLayout.add(actions);for(const element of [actions,fold]){resize.unobserve(element);resize.observe(element);}}
      return;
    }
    measureNow(measure);
  };
  const measureNow=(measure:Measure[])=>{
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
  const schedule=()=>{full=true;if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const scheduleScoped=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  // Runs after layout. Read every affected toolbar and header first, then
  // write. A write that rewraps a title or resizes the fold resizes an observed
  // element, so the browser delivers another notification before painting.
  const measureAfterLayout=(items:Measure[])=>{
    const read=items.map(item=>{
      const parent=(item.actions.offsetParent as HTMLElement|null)??item.fold;
      return {...item,parent,toolbar:item.actions.getBoundingClientRect(),header:item.heading.getBoundingClientRect(),box:item.fold.getBoundingClientRect(),container:parent.getBoundingClientRect(),clientTop:parent.clientTop,row:item.footer?.getBoundingClientRect()};
    });
    const spacing=(fold:HTMLElement)=>['--send-to-t3-stream-actions-space','--send-to-t3-stream-actions-footer','--send-to-t3-stream-footer-space'].map(name=>fold.style.getPropertyValue(name)).join();
    const refit:Measure[]=[];
    for(const item of read){
      const {actions,fold,heading,footer,bottom,toolbar,header,box,container,clientTop,row}=item,before=spacing(fold);
      setPx(fold,'--send-to-t3-stream-actions-space',!bottom&&toolbar.width>0?toolbar.width+8:0);
      setPx(fold,'--send-to-t3-stream-actions-footer',bottom&&!footer?toolbar.height+8:0);
      setPx(fold,'--send-to-t3-stream-footer-space',bottom?toolbar.width+8:0);
      // A bottom toolbar without a status row sits on the fold's own edge,
      // which its new footer padding moves. Remeasure only that case.
      if(bottom&&!footer&&spacing(fold)!==before){refit.push({actions,fold,heading,footer,bottom});continue;}
      const origin=container.top+clientTop,top=header.top+header.height/2;
      setPx(actions,'--send-to-t3-stream-top-center',top-origin);
      setPx(actions,'--send-to-t3-stream-bottom-center',(row?row.top+row.height/2:box.bottom-(bottom?toolbar.height/2+4:top-box.top))-origin);
    }
    if(refit.length)measureNow(refit);
  };
  const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(entries=>{
    if(disposed)return;
    const dirty=new Set(awaitingLayout);awaitingLayout.clear();
    for(const {target} of entries){
      const actions=watched.get(target);
      if(actions)dirty.add(actions);
    }
    const items:Measure[]=[];
    for(const actions of dirty){
      const layout=layouts.get(actions);
      if(!owned.has(actions)||!layout||!actions.isConnected||!layout.fold.isConnected)continue;
      items.push({actions,fold:layout.fold,heading:layout.heading,footer:layout.footer,bottom:layout.bottom});
    }
    if(items.length)measureAfterLayout(items);
  });
  // Map a changed node to the stream fold whose controls it can affect: its
  // own fold, or the fold of the native widget that holds its toolbar.
  const widgetOrReadingFold=(element:Element)=>isEmbedBlock(element)||isProgressFold(element)&&!!closestWhere(element,isReadingView);
  const foldOf=(element:Element)=>{
    const fold=closestWhere(element,isProgressFold) as HTMLElement|null;if(fold)pending.add(fold);
    const block=closestWhere(element,isEmbedBlock),first=block?.querySelector<HTMLElement>('.callout');
    if(first&&isProgressFold(first))pending.add(first);
    const actions=block?.querySelector<HTMLElement>(':scope > .embed-actions');if(actions)touched.add(actions);
  };
  const changed=(batch:DomBatch)=>{
    if(batch.opaque){schedule();return;}
    const before=pending.size+touched.size;
    for(const record of batch.attributes()){
      const target=record.target as Element;
      if(target.classList?.contains('callout')&&target.getAttribute('data-callout')==='t3-progress'&&((record.oldValue??'').split(/\s+/).includes('is-collapsed')!==target.classList.contains('is-collapsed')))pending.add(target as HTMLElement);
    }
    if(batch.childList){
      for(const fold of batch.within(isProgressFold))pending.add(fold as HTMLElement);
      for(const block of batch.within(isEmbedBlock))foldOf(block);
      // An added node's ancestors are its record target's: map each changed
      // parent once to its widget or Reading fold.
      for(const parent of batch.containing(widgetOrReadingFold))foldOf(parent);
    }
    if(pending.size+touched.size>before||batch.removed)scheduleScoped();
  };
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
  const stopChanges=observeDocumentChanges(root,changed);
  root.addEventListener(responseControlsChanged,schedule);
  refresh();
  return ()=>{disposed=true;root.removeEventListener(responseControlsChanged,schedule);stopControls();stopDrag();stopChanges();resize?.disconnect();root.removeEventListener(responseScrollChanged,schedule);root.removeEventListener('pointerdown',pointer,true);root.removeEventListener('mousedown',pointer,true);root.removeEventListener('click',click,true);for(const [actions,controls] of owned){controls.close.remove();controls.follow.remove();controls.signIn.remove();controls.footer?.classList.remove('send-to-t3-stream-footer');controls.fold.style.removeProperty('--send-to-t3-stream-footer-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-space');controls.fold.style.removeProperty('--send-to-t3-stream-actions-footer');actions.classList.remove('send-to-t3-stream-actions','send-to-t3-stream-actions-bottom','send-to-t3-stream-actions-active','send-to-t3-stream-actions-moving','send-to-t3-stream-auth-required');if(controls.reading){actions.parentElement?.classList.remove('send-to-t3-has-reading-actions');actions.remove();}actions.closest('.cm-embed-block')?.classList.remove('send-to-t3-stream-collapsed');}owned.clear();};
}
