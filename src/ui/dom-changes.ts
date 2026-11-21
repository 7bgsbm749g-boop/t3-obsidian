/** Attributes that plugin listeners react to. Other attribute writes, including
 * CodeMirror's own, never reach the plugin. */
export const OBSERVED_ATTRIBUTES=['class','data-t3-active-title','data-t3-shine','data-t3-tool-status','data-status'] as const;

/** Everything plugin listeners look for in an added subtree. An added node
 * that neither matches nor contains it needs no per-feature queries. */
export const PLUGIN_MARKUP='.callout, .cm-embed-block, [class*="send-to-t3-"], [data-t3-active-title], [data-t3-tool-icon], [data-t3-setup-start], [data-t3-start], [data-t3-tool-group], [data-t3-tool-key], [data-t3-answer-id], [data-t3-tasks-id], [data-t3-plan-id], [data-t3-worktree-setup], [data-t3-question], a[href^="t3-question:"]';

const elementLike=(node:unknown):node is Element=>!!node&&(node as Node).nodeType===1&&typeof Reflect.get(node,'querySelectorAll')==='function'&&typeof Reflect.get(node,'matches')==='function';

/** One batch of document mutations. Each listener reads it through memoized
 * helpers, so the selector work for a batch is shared by all listeners. */
export class DomBatch {
  private addedCache?:Element[];
  private scopeCache?:Element[];
  private withinCache=new Map<string,Element[]>();
  private containingCache=new Map<string,Element[]>();
  private flags?:{elements:boolean;removed:boolean;opaque:boolean;childList:boolean};
  constructor(readonly records:readonly MutationRecord[]){}
  private scan(){
    if(this.flags)return this.flags;
    const flags={elements:false,removed:false,opaque:false,childList:false},added:Element[]=[];
    for(const record of this.records){
      if(record.type==='attributes')continue;
      flags.childList=true;
      for(const node of Array.from(record.addedNodes??[]))if(node.nodeType===1){
        flags.elements=true;
        if(elementLike(node))added.push(node);else flags.opaque=true;
      }
      for(const node of Array.from(record.removedNodes??[]))if(node.nodeType===1){flags.elements=flags.removed=true;}
    }
    // A batch without records gives no scope to narrow; callers rescan.
    if(!this.records.length)flags.opaque=true;
    this.addedCache=added;this.flags=flags;return flags;
  }
  /** Any childList record, including text-only changes. */
  get childList(){return this.scan().childList;}
  /** An element node was added or removed. */
  get elements(){return this.scan().elements;}
  get removed(){return this.scan().removed;}
  /** Some change cannot be narrowed to inspectable elements. */
  get opaque(){return this.scan().opaque;}
  added():readonly Element[]{this.scan();return this.addedCache!;}
  /** Connected added subtrees that hold plugin markup. */
  scopes():readonly Element[]{
    if(!this.scopeCache)this.scopeCache=this.added().filter(root=>root.isConnected&&(root.matches(PLUGIN_MARKUP)||!!root.firstElementChild&&!!root.querySelector(PLUGIN_MARKUP)));
    return this.scopeCache;
  }
  /** Connected elements matching selector in added subtrees, roots included.
   * The selector must be covered by PLUGIN_MARKUP. */
  within(selector:string):readonly Element[]{
    let found=this.withinCache.get(selector);
    if(!found){
      const result=new Set<Element>();
      for(const root of this.scopes()){
        if(root.matches(selector))result.add(root);
        for(const element of Array.from(root.querySelectorAll(selector)))result.add(element);
      }
      found=[...result];this.withinCache.set(selector,found);
    }
    return found;
  }
  /** The nearest matching ancestor-or-self of each element whose children changed. */
  containing(selector:string):readonly Element[]{
    let found=this.containingCache.get(selector);
    if(!found){
      const targets=new Set<Element>(),result=new Set<Element>();
      for(const record of this.records)if(record.type==='childList'&&elementLike(record.target))targets.add(record.target);
      for(const target of targets){const match=target.isConnected?target.closest(selector):null;if(match)result.add(match);}
      found=[...result];this.containingCache.set(selector,found);
    }
    return found;
  }
  attributes():MutationRecord[]{return this.records.filter(record=>record.type==='attributes');}
}

type Listener=(batch:DomBatch)=>void;
const hubs=new WeakMap<Document,{observer:MutationObserver;listeners:Set<Listener>}>();

/** Share one subtree observer per document. CodeMirror's changes then reach the
 * plugin once per batch instead of once for each plugin feature. */
export function observeDocumentChanges(root:Document,listener:Listener):()=>void {
  let hub=hubs.get(root);
  if(!hub){
    const Observer=typeof MutationObserver==='function'?MutationObserver:root.defaultView?.MutationObserver;
    if(typeof Observer!=='function'||!root.body)return ()=>{};
    const listeners=new Set<Listener>();
    const observer=new Observer(records=>{
      const batch=new DomBatch(records??[]);
      for(const current of [...listeners])try{current(batch);}catch(error){queueMicrotask(()=>{throw error;});}
    });
    observer.observe(root.body,{childList:true,subtree:true,attributes:true,attributeFilter:[...OBSERVED_ATTRIBUTES],attributeOldValue:true});
    hub={observer,listeners};hubs.set(root,hub);
  }
  const current=hub;current.listeners.add(listener);
  return ()=>{
    current.listeners.delete(listener);
    if(!current.listeners.size){current.observer.disconnect();if(hubs.get(root)===current)hubs.delete(root);}
  };
}
