import {observeDocumentChanges,type DomBatch} from './dom-changes';
const SHINE_SELECTOR='[data-t3-active-title="true"], .send-to-t3-tool[data-t3-tool-status="inProgress"] > summary > span:not([data-t3-tool-icon]), .send-to-t3-file-opening, .send-to-t3-run-status[data-status="Running"] + .send-to-t3-run-name';
/** Client-local animation. Canonical loading markers retain Stop and recovery identities. */
export function activityShineTargets(root:ParentNode):Set<HTMLElement> {
  const targets=new Set(Array.from(root.querySelectorAll<HTMLElement>(SHINE_SELECTOR)));
  for(const label of spinnerLabels(Array.from(root.querySelectorAll<HTMLElement>('.send-to-t3-inline-spinner'))))targets.add(label);
  return targets;
}
const has=(element:Element|null|undefined,name:string)=>!!element?.classList.contains(name);
function spinnerLabels(spinners:HTMLElement[]):HTMLElement[] {
  const labels:HTMLElement[]=[];
  for(const spinner of spinners){
    let label=spinner.previousElementSibling as HTMLElement|null;
    while(label?.matches('.send-to-t3-run-timer'))label=label.previousElementSibling as HTMLElement|null;
    if(label?.matches('strong, span')&&!label.hasAttribute('data-t3-tool-icon')&&label.textContent?.trim())labels.push(label);
  }
  return labels;
}
const inProgressTool=(element:Element)=>has(element,'send-to-t3-tool')&&element.getAttribute('data-t3-tool-status')==='inProgress';
/** Shine targets among plugin markup elements (see PLUGIN_MARKUP), classified
 * with the same rules as activityShineTargets but without selector queries. */
export function activityShineTargetsAmong(elements:Iterable<Element>):Set<HTMLElement> {
  const targets=new Set<HTMLElement>();
  for(const element of elements){
    if(!element.isConnected)continue;
    if(element.getAttribute('data-t3-active-title')==='true'||has(element,'send-to-t3-file-opening'))targets.add(element as HTMLElement);
    if(has(element,'send-to-t3-run-name')){const status=element.previousElementSibling;if(has(status,'send-to-t3-run-status')&&status!.getAttribute('data-status')==='Running')targets.add(element as HTMLElement);}
    if(inProgressTool(element))for(const summary of Array.from(element.children))if(summary.tagName==='SUMMARY')for(const span of Array.from(summary.children))if(span.tagName==='SPAN'&&!span.hasAttribute('data-t3-tool-icon'))targets.add(span as HTMLElement);
    if(has(element,'send-to-t3-inline-spinner'))for(const label of spinnerLabels([element as HTMLElement]))targets.add(label);
  }
  return targets;
}

/** Whether a connected element is still a shine target in place. */
export function isActivityShineTarget(element:HTMLElement):boolean {
  if(element.matches(SHINE_SELECTOR))return true;
  let next=element.nextElementSibling;
  while(next?.matches('.send-to-t3-run-timer'))next=next.nextElementSibling;
  return !!next?.matches('.send-to-t3-inline-spinner')&&spinnerLabels([next as HTMLElement]).includes(element);
}

export function installActivityShine(root:Document):()=>void {
  const watched=new Map<HTMLElement,boolean>();
  const window=root.defaultView;
  const motion=window?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let queued=false,disposed=false;
  const update=(element:HTMLElement)=>element.style.setProperty('--send-to-t3-shine-state',
    watched.get(element)&&root.visibilityState==='visible'&&!motion?.matches?'running':'paused');
  const visibility=()=>{for(const element of watched.keys())update(element);};
  const intersection=window?.IntersectionObserver?new window.IntersectionObserver(entries=>{
    for(const entry of entries)if(watched.has(entry.target as HTMLElement)){
      watched.set(entry.target as HTMLElement,entry.isIntersecting);update(entry.target as HTMLElement);
    }
  }):undefined;
  const clear=(element:HTMLElement)=>{intersection?.unobserve(element);element.removeAttribute('data-t3-shine');element.removeAttribute('data-t3-circle');element.style.removeProperty('--send-to-t3-shine-state');watched.delete(element);};
  // Added subtrees can only add targets. A removal can end a current target,
  // so it rechecks those; attribute changes rescan the document.
  let full=true,recheck=false;const scoped=new Set<Element>();
  const refresh=()=>{
    queued=false;if(disposed)return;
    const everything=full,removed=recheck,scopes=[...scoped];full=recheck=false;scoped.clear();
    let targets:Set<HTMLElement>;
    if(everything){
      targets=activityShineTargets(root);
      for(const element of watched.keys())if(!targets.has(element)||!element.isConnected)clear(element);
    }else{
      if(removed)for(const element of [...watched.keys()])if(!element.isConnected||!isActivityShineTarget(element))clear(element);
      targets=activityShineTargetsAmong(scopes);
    }
    for(const element of targets){
      if(!watched.has(element)){watched.set(element,!intersection);intersection?.observe(element);}
      if(element.getAttribute('data-t3-shine')!=='true')element.setAttribute('data-t3-shine','true');
      // Discard decoration left by older clients; loading is text-only now.
      element.removeAttribute('data-t3-circle');
      update(element);
    }
  };
  const schedule=(everything=true)=>{if(everything)full=true;if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const changed=(batch:DomBatch)=>{
    const attributes=batch.attributes().some(record=>{const target=record.target as Element;return record.attributeName!=='class'||!!target.classList?.contains('send-to-t3-file-opening')||!!target.hasAttribute?.('data-t3-shine');});
    if(attributes||batch.opaque){schedule();return;}
    if(batch.removed&&watched.size)recheck=true;
    for(const element of batch.markup())scoped.add(element);
    // A label added inside an existing in-progress tool summary.
    for(const tool of batch.containing(inProgressTool))scoped.add(tool);
    if(recheck||scoped.size)schedule(false);
  };
  const stopChanges=observeDocumentChanges(root,changed);
  root.addEventListener('visibilitychange',visibility);motion?.addEventListener('change',visibility);refresh();
  return ()=>{disposed=true;stopChanges();intersection?.disconnect();root.removeEventListener('visibilitychange',visibility);motion?.removeEventListener('change',visibility);for(const element of watched.keys())clear(element);};
}
