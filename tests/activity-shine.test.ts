import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityShineTargets,installActivityShine} from '../src/ui/activity-shine';

class Element {
  attrs=new Map<string,string>();properties=new Map<string,string>();textContent='';isConnected=true;
  previousElementSibling:Element|null=null;
  activityContainer=false;
  closest(){return this.activityContainer?this:null;}
  style={setProperty:(key:string,value:string)=>this.properties.set(key,value),removeProperty:(key:string)=>this.properties.delete(key)};
  constructor(public tag='span',public timer=false){}
  matches(selector:string){return selector==='.send-to-t3-run-timer'?this.timer:selector.split(', ').includes(this.tag);}
  getAttribute(key:string){return this.attrs.get(key)??null;}
  hasAttribute(key:string){return this.attrs.has(key);}
  setAttribute(key:string,value:string){this.attrs.set(key,value);}
  removeAttribute(key:string){this.attrs.delete(key);}
}

test('response shine targets the existing text across headers, tools and compaction without touching timers or icons',()=>{
  const header=new Element('strong'),thinking=new Element(),tool=new Element(),compaction=new Element(),icon=new Element();
  [header,thinking,tool,compaction].forEach(label=>label.textContent='Existing text');icon.setAttribute('data-t3-tool-icon','brain');
  const timer=new Element('span',true);timer.previousElementSibling=header;
  const spinners=[timer,thinking,tool,compaction,icon].map(previous=>{const marker=new Element();marker.previousElementSibling=previous;return marker;});
  const root={querySelectorAll:(selector:string)=>selector.includes('active-title')?[]:spinners};
  assert.deepEqual([...activityShineTargets(root as any)],[header,thinking,tool,compaction]);
  spinners.splice(0);assert.equal(activityShineTargets(root as any).size,0,'Stop removes the marker and animation target together');
});

test('shine pauses when offscreen, hidden or reduced, survives native reconciliation and releases all observers',async()=>{
  const previous=globalThis.MutationObserver;
  let mutate:Function=()=>{},intersect:Function=()=>{},disconnected=false,unobserved=0;
  const events=new Map<string,Function>(),mediaEvents=new Map<string,Function>();
  const motion={matches:false,addEventListener:(name:string,fn:Function)=>mediaEvents.set(name,fn),removeEventListener:(name:string)=>mediaEvents.delete(name)};
  class Observer {constructor(callback:Function){mutate=callback;}observe(){}disconnect(){disconnected=true;}}
  class Intersection {constructor(callback:Function){intersect=callback;}observe(){}unobserve(){unobserved++;}disconnect(){}}
  globalThis.MutationObserver=Observer as any;
  const label=new Element();label.setAttribute('data-t3-active-title','true');label.setAttribute('data-t3-circle','true');let targets=[label];
  const root={body:{},visibilityState:'visible',defaultView:{IntersectionObserver:Intersection,matchMedia:()=>motion},
    querySelectorAll:(selector:string)=>selector.includes('active-title')?targets:[],
    addEventListener:(name:string,fn:Function)=>events.set(name,fn),removeEventListener:(name:string)=>events.delete(name)};
  try{
    const dispose=installActivityShine(root as any);
    assert.equal(label.hasAttribute('data-t3-circle'),false);
    const state=()=>label.properties.get('--send-to-t3-shine-state');
    assert.equal(state(),'paused');intersect([{target:label,isIntersecting:true}]);assert.equal(state(),'running');
    root.visibilityState='hidden';events.get('visibilitychange')!();assert.equal(state(),'paused');
    root.visibilityState='visible';events.get('visibilitychange')!();assert.equal(state(),'running');
    motion.matches=true;mediaEvents.get('change')!();assert.equal(state(),'paused');
    motion.matches=false;mediaEvents.get('change')!();assert.equal(state(),'running');
    label.removeAttribute('data-t3-shine');label.setAttribute('data-t3-circle','true');label.properties.clear();mutate([{type:'attributes'}]);await Promise.resolve();
    assert.equal(label.getAttribute('data-t3-shine'),'true');assert.equal(state(),'running');
    assert.equal(label.hasAttribute('data-t3-circle'),false);
    intersect([{target:label,isIntersecting:false}]);assert.equal(state(),'paused');
    targets=[];mutate([{type:'childList',addedNodes:[],removedNodes:[{nodeType:1}]}]);await Promise.resolve();
    assert.equal(label.hasAttribute('data-t3-shine'),false);assert.equal(state(),undefined);assert.equal(unobserved,1);
    assert.equal(label.hasAttribute('data-t3-circle'),false);
    dispose();assert.equal(disconnected,true);assert.equal(events.size,0);assert.equal(mediaEvents.size,0);
  }finally{globalThis.MutationObserver=previous;}
});

test('tool status and transient loading labels refresh shine without new loading markers',async()=>{
  const previous=globalThis.MutationObserver;
  let mutate:Function=()=>{},options:MutationObserverInit|undefined;
  class Observer {constructor(callback:Function){mutate=callback;}observe(_root:unknown,value:MutationObserverInit){options=value;}disconnect(){}}
  globalThis.MutationObserver=Observer as any;
  const tool=new Element(),notice=new Element(),run=new Element();let active=true;
  const root={body:{},visibilityState:'visible',defaultView:{},
    querySelectorAll:(selector:string)=>selector==='.send-to-t3-inline-spinner'?[]:active?[tool,notice,run]:[],
    addEventListener(){},removeEventListener(){}};
  try{
    const dispose=installActivityShine(root as any);
    assert.ok(options?.attributeFilter?.includes('data-t3-tool-status'));
    assert.ok(options?.attributeFilter?.includes('data-status'));
    assert.ok(options?.attributeFilter?.includes('class'));
    for(const label of [tool,notice,run]){assert.equal(label.getAttribute('data-t3-shine'),'true');assert.equal(label.hasAttribute('data-t3-circle'),false);}
    active=false;mutate([{type:'attributes',attributeName:'data-t3-tool-status'}]);await Promise.resolve();
    for(const label of [tool,notice,run]){assert.equal(label.hasAttribute('data-t3-shine'),false);assert.equal(label.properties.has('--send-to-t3-shine-state'),false);}
    dispose();
  }finally{globalThis.MutationObserver=previous;}
});
