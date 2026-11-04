/** A cached link can lag the native editor's current input event. Retain only
 * that event's wiki-link context until its dispatch stack has finished. */
export class WikiGesture {
  private current?:{source:string;target:Element};
  owns(source:string):boolean{return this.current?.source===source;}
  watch(root:Document,sourceFor:(element:Element)=>string):()=>void{
    const capture=(event:Event)=>{
      if(event.type==='keydown'&&(event as KeyboardEvent).key!=='Enter')return;
      const target=(event.target as Element|null)?.closest?.('.cm-hmd-internal-link');
      const context=target?{source:sourceFor(target),target}:undefined;
      this.current=context;
      queueMicrotask(()=>{if(this.current===context)this.current=undefined;});
    };
    const types=['click','pointerdown','mousedown','keydown'];
    for(const type of types)root.addEventListener(type,capture,true);
    return ()=>{for(const type of types)root.removeEventListener(type,capture,true);if(this.current?.target.ownerDocument===root)this.current=undefined;};
  }
}
