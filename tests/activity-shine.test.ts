import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
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

function loadingDocument():Document {
  return parseHTML(`<!doctype html><html><body>
    <strong id="active-title" data-t3-active-title="true">Working</strong>
    <strong id="inactive-title" data-t3-active-title="false">Complete</strong>
    <details id="tool" class="send-to-t3-tool" data-t3-tool-status="inProgress">
      <summary><span id="tool-icon" data-t3-tool-icon="terminal"></span><span id="tool-label">Running command<span id="nested-tool-text">Detail</span></span></summary>
      <span id="tool-output">Output</span>
    </details>
    <details class="send-to-t3-tool" data-t3-tool-status="completed">
      <summary><span id="completed-tool">Completed command</span></summary>
    </details>
    <span id="notice" class="send-to-t3-file-opening">Opening file</span>
    <span id="other-notice">File opened</span>
    <div><span id="run-status" class="send-to-t3-run-status" data-status="Running"></span><span id="run-label" class="send-to-t3-run-name">Active run</span></div>
    <div><span class="send-to-t3-run-status" data-status="Completed"></span><span id="completed-run" class="send-to-t3-run-name">Completed run</span></div>
    <div><span class="send-to-t3-run-status" data-status="Failed"></span><span id="failed-run" class="send-to-t3-run-name">Failed run</span></div>
    <div><span data-status="Running"></span><span id="unrelated-run" class="send-to-t3-run-name">Unrelated label</span></div>
    <div><span class="send-to-t3-run-status" data-status="Running"></span><span></span><span id="nonadjacent-run" class="send-to-t3-run-name">Nonadjacent label</span></div>
  </body></html>`).document as unknown as Document;
}

test('loading selectors match active labels and exclude completed labels, icons and unrelated text',()=>{
  const root=loadingDocument();
  assert.deepEqual([...activityShineTargets(root)].map(label=>label.id),['active-title','tool-label','notice','run-label']);
});

test('tool status and transient loading labels refresh shine without new loading markers',async()=>{
  const previous=globalThis.MutationObserver;
  let mutate:Function=()=>{},options:MutationObserverInit|undefined;
  class Observer {constructor(callback:Function){mutate=callback;}observe(_root:unknown,value:MutationObserverInit){options=value;}disconnect(){}}
  globalThis.MutationObserver=Observer as any;
  const root=loadingDocument(),tool=root.getElementById('tool')!,notice=root.getElementById('notice')!,run=root.getElementById('run-status')!;
  const labels=['tool-label','notice','run-label'].map(id=>root.getElementById(id)!);
  Object.defineProperty(root,'visibilityState',{value:'visible'});
  for(const label of labels)label.setAttribute('data-t3-circle','true');
  try{
    const dispose=installActivityShine(root);
    assert.ok(options?.attributeFilter?.includes('data-t3-tool-status'));
    assert.ok(options?.attributeFilter?.includes('data-status'));
    assert.ok(options?.attributeFilter?.includes('class'));
    for(const label of labels){assert.equal(label.getAttribute('data-t3-shine'),'true');assert.equal(label.hasAttribute('data-t3-circle'),false);}
    tool.setAttribute('data-t3-tool-status','completed');run.setAttribute('data-status','Completed');notice.classList.remove('send-to-t3-file-opening');
    mutate([{type:'attributes',target:tool,attributeName:'data-t3-tool-status'},{type:'attributes',target:run,attributeName:'data-status'},{type:'attributes',target:notice,attributeName:'class'}]);await Promise.resolve();
    assert.deepEqual([...activityShineTargets(root)].map(label=>label.id),['active-title']);
    for(const label of labels){assert.equal(label.hasAttribute('data-t3-shine'),false);assert.equal(label.style.getPropertyValue('--send-to-t3-shine-state')||'', '');}
    assert.equal(root.getElementById('active-title')!.getAttribute('data-t3-shine'),'true','unrelated active titles keep their shine');
    dispose();
  }finally{globalThis.MutationObserver=previous;}
});
