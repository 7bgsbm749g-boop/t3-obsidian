/** Client-local animation. Canonical loading markers retain Stop and recovery identities. */
export function activityShineTargets(root:ParentNode):Set<HTMLElement> {
  const targets=new Set(Array.from(root.querySelectorAll<HTMLElement>('[data-t3-active-title="true"]')));
  for(const spinner of Array.from(root.querySelectorAll<HTMLElement>('.send-to-t3-inline-spinner'))){
    let label=spinner.previousElementSibling as HTMLElement|null;
    while(label?.matches('.send-to-t3-run-timer'))label=label.previousElementSibling as HTMLElement|null;
    if(label?.matches('strong, span')&&!label.hasAttribute('data-t3-tool-icon')&&label.textContent?.trim())targets.add(label);
  }
  return targets;
}

/** The circle accompanies titles and the top stream header, not activity rows. */
export function activityCircleTarget(label:HTMLElement):boolean {
  return label.getAttribute('data-t3-active-title')==='true'||
    label.matches('strong')&&!label.closest('.send-to-t3-response-activity, .send-to-t3-context, .send-to-t3-tool, [data-t3-tool-group]');
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
  const refresh=()=>{
    queued=false;if(disposed)return;
    const targets=activityShineTargets(root);
    for(const element of watched.keys())if(!targets.has(element)||!element.isConnected)clear(element);
    for(const element of targets){
      if(!watched.has(element)){watched.set(element,!intersection);intersection?.observe(element);}
      if(element.getAttribute('data-t3-shine')!=='true')element.setAttribute('data-t3-shine','true');
      if(activityCircleTarget(element)){
        if(element.getAttribute('data-t3-circle')!=='true')element.setAttribute('data-t3-circle','true');
      }else if(element.hasAttribute('data-t3-circle'))element.removeAttribute('data-t3-circle');
      update(element);
    }
  };
  const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const observer=new MutationObserver(records=>{
    if(records.some(record=>record.type==='attributes'||[...Array.from(record.addedNodes),...Array.from(record.removedNodes)].some(node=>node.nodeType===1)))schedule();
  });
  observer.observe(root.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-t3-active-title','data-t3-shine','data-t3-circle']});
  root.addEventListener('visibilitychange',visibility);motion?.addEventListener('change',visibility);refresh();
  return ()=>{disposed=true;observer.disconnect();intersection?.disconnect();root.removeEventListener('visibilitychange',visibility);motion?.removeEventListener('change',visibility);for(const element of watched.keys())clear(element);};
}
