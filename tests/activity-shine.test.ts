import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityShineTargets,installActivityShine} from '../activity-shine';

class Element {
  attrs=new Map<string,string>();properties=new Map<string,string>();textContent='';isConnected=true;
  previousElementSibling:Element|null=null;
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
  const label=new Element();let targets=[label];
  const root={body:{},visibilityState:'visible',defaultView:{IntersectionObserver:Intersection,matchMedia:()=>motion},
    querySelectorAll:(selector:string)=>selector.includes('active-title')?targets:[],
    addEventListener:(name:string,fn:Function)=>events.set(name,fn),removeEventListener:(name:string)=>events.delete(name)};
  try{
    const dispose=installActivityShine(root as any);
    const state=()=>label.properties.get('--send-to-t3-shine-state');
    assert.equal(state(),'paused');intersect([{target:label,isIntersecting:true}]);assert.equal(state(),'running');
    root.visibilityState='hidden';events.get('visibilitychange')!();assert.equal(state(),'paused');
    root.visibilityState='visible';events.get('visibilitychange')!();assert.equal(state(),'running');
    motion.matches=true;mediaEvents.get('change')!();assert.equal(state(),'paused');
    motion.matches=false;mediaEvents.get('change')!();assert.equal(state(),'running');
    label.removeAttribute('data-t3-shine');label.properties.clear();mutate([{type:'attributes'}]);await Promise.resolve();
    assert.equal(label.getAttribute('data-t3-shine'),'true');assert.equal(state(),'running');
    intersect([{target:label,isIntersecting:false}]);assert.equal(state(),'paused');
    targets=[];mutate([{type:'childList',addedNodes:[],removedNodes:[{nodeType:1}]}]);await Promise.resolve();
    assert.equal(label.hasAttribute('data-t3-shine'),false);assert.equal(state(),undefined);assert.equal(unobserved,1);
    dispose();assert.equal(disconnected,true);assert.equal(events.size,0);assert.equal(mediaEvents.size,0);
  }finally{globalThis.MutationObserver=previous;}
});
