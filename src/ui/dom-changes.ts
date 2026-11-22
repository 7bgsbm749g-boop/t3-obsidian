/** Attributes that plugin listeners react to. Other attribute writes, including
 * CodeMirror's own, never reach the plugin. */
export const OBSERVED_ATTRIBUTES=['class','data-t3-active-title','data-t3-shine','data-t3-tool-status','data-status'] as const;

/** Attributes that mark plugin markup. */
export const PLUGIN_ATTRIBUTES=['data-t3-active-title','data-t3-tool-icon','data-t3-setup-start','data-t3-start','data-t3-tool-group','data-t3-tool-key','data-t3-answer-id','data-t3-tasks-id','data-t3-plan-id','data-t3-worktree-setup','data-t3-question'] as const;
/** Everything plugin listeners look for in an added subtree. An added node
 * that neither matches nor contains it needs no plugin work. */
export const PLUGIN_MARKUP=['.callout','.cm-embed-block','[class*="send-to-t3-"]',...PLUGIN_ATTRIBUTES.map(name=>`[${name}]`),'a[href^="t3-question:"]'].join(', ');

export type ElementTest=(element:Element)=>boolean;
const elementLike=(node:unknown):node is Element=>!!node&&(node as Node).nodeType===1&&typeof Reflect.get(node,'querySelectorAll')==='function'&&typeof Reflect.get(node,'matches')==='function';
const hasClass=(element:Element,name:string)=>element.classList?.contains(name)??false;

/** Whether an element itself matches PLUGIN_MARKUP, without selector matching. */
export function hasPluginMarkup(element:Element):boolean {
  if(hasClass(element,'callout')||hasClass(element,'cm-embed-block')||element.getAttribute('class')?.includes('send-to-t3-'))return true;
  for(const name of PLUGIN_ATTRIBUTES)if(element.hasAttribute(name))return true;
  return element.tagName==='A'&&!!element.getAttribute('href')?.startsWith('t3-question:');
}
/** Plugin markup in a subtree, the root included, in document order. */
export function pluginMarkupIn(scope:Element):Element[] {
  const found:Element[]=hasPluginMarkup(scope)?[scope]:[];
  if(scope.firstElementChild)found.push(...Array.from(scope.querySelectorAll(PLUGIN_MARKUP)));
  return found;
}
/** Nearest ancestor-or-self that passes the test, walking parents directly. */
export function closestWhere(element:Element|null|undefined,test:ElementTest):Element|null {
  for(let current=element??null;current;current=current.parentElement)if(test(current))return current;
  return null;
}
export const isProgressFold:ElementTest=element=>hasClass(element,'callout')&&element.getAttribute('data-callout')==='t3-progress';
export const isThoughtFold:ElementTest=element=>hasClass(element,'callout')&&element.getAttribute('data-callout')==='t3-thought';
export const isEmbedBlock:ElementTest=element=>hasClass(element,'cm-embed-block');
export const isReadingView:ElementTest=element=>hasClass(element,'markdown-preview-view');

/** One batch of document mutations. Each listener reads it through memoized
 * helpers, so the markup lookup for a batch is shared by all listeners. */
export class DomBatch {
  private addedCache?:Element[];
  private scopeCache?:{scopes:Element[];markup:Element[]};
  private withinCache=new Map<ElementTest,Element[]>();
  private containingCache=new Map<ElementTest,Element[]>();
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
  private markupScopes(){
    if(!this.scopeCache){
      const roots=new Set(this.added().filter(root=>root.isConnected)),scopes:Element[]=[],markup=new Set<Element>();
      for(const root of roots){
        // A node inside another added subtree is covered by that subtree.
        let nested=false;for(let parent=root.parentElement;parent&&!nested;parent=parent.parentElement)nested=roots.has(parent);
        if(nested)continue;
        const found=pluginMarkupIn(root);
        if(found.length){scopes.push(root);for(const element of found)markup.add(element);}
      }
      this.scopeCache={scopes,markup:[...markup]};
    }
    return this.scopeCache;
  }
  /** Connected added subtrees that hold plugin markup. */
  scopes():readonly Element[]{return this.markupScopes().scopes;}
  /** All plugin markup in those subtrees, roots included. */
  markup():readonly Element[]{return this.markupScopes().markup;}
  /** Added plugin markup that passes the test. */
  within(test:ElementTest):readonly Element[]{
    let found=this.withinCache.get(test);
    if(!found){found=this.markup().filter(test);this.withinCache.set(test,found);}
    return found;
  }
  /** The nearest ancestor-or-self that passes the test, for each element whose
   * children changed. An added node's ancestors are its record target's. */
  containing(test:ElementTest):readonly Element[]{
    let found=this.containingCache.get(test);
    if(!found){
      const targets=new Set<Element>(),result=new Set<Element>();
      for(const record of this.records)if(record.type==='childList'&&elementLike(record.target))targets.add(record.target);
      for(const target of targets){const match=target.isConnected?closestWhere(target,test):null;if(match)result.add(match);}
      found=[...result];this.containingCache.set(test,found);
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
