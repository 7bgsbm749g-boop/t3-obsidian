import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installStreamStopControls,type StreamStopTarget} from '../stream-stop-control';
import {NativeResponseView} from '../native-response-view';
import {responseAnchor} from '../native-response-projection';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const body=(key:string)=>`> [!t3-progress]+ Working <span data-t3-fold="${key}"></span>\n> Streamed text.`;
test('Stop requires one explicitly active response; completion, conflicts and a changed file revoke it',()=>{
  const saved=responseAnchor(id)+'\n\n'+responseAnchor(other);let display=saved;
  const view:any={file:{path:'Note.md'},getViewData:()=>display,setViewData:(text:string)=>{display=text;},getMode:()=> 'preview',requestSave(){},save:async()=>{}};
  const adapter=new NativeResponseView(view,saved,()=>{},async()=>saved);
  adapter.setResponses([{id,body:body('first:active'),stoppable:true},{id:other,body:body('second:active'),stoppable:true}]);
  assert.equal(adapter.stopControl('first:active'),id);assert.equal(adapter.stopControl('second:active'),other);
  assert.equal(adapter.saved(),saved,'Control lookup does not change durable anchors');
  adapter.setResponses([{id,body:body('first:active'),stoppable:false},{id:other,body:body('second:active'),stoppable:true}]);
  assert.equal(adapter.stopControl('first:active'),undefined,'A terminal preview may still have an active fold key');
  assert.equal(adapter.stopControl('second:active'),other);
  adapter.setResponses([{id,body:body('first:complete'),stoppable:true},{id:other,body:body('first:complete'),stoppable:true}]);
  assert.equal(adapter.stopControl('first:complete'),undefined);
  adapter.setResponses([{id,body:body('same:active'),stoppable:true},{id:other,body:body('same:active'),stoppable:true}]);
  assert.equal(adapter.stopControl('same:active'),undefined,'Ambiguous folds cannot select a run');
  adapter.setResponses([{id,body:body('first:active'),stoppable:true}]);
  view.file={path:'Other.md'};assert.equal(adapter.stopControl('first:active'),undefined);
  adapter.dispose();assert.equal(adapter.stopControl('first:active'),undefined);
  display=saved;
  const blocked=new NativeResponseView(view,saved,()=>{},async()=>saved);
  blocked.setResponses([{id,body:body('first:active'),stoppable:true}]);
  blocked.preserveConflict({base:saved,local:saved,incoming:saved,reason:'conflict'});
  assert.equal(blocked.stopControl('first:active'),undefined);blocked.dispose();
});

// A small event/DOM port exercises the production controller. Native editor
// selection, rendering, keyboard activation and touch layout have a real-app lab.
class Element {
  parentElement:Element|null=null;children:Element[]=[];hidden=false;disabled=false;type='';className='';attrs=new Map<string,string>();
  classes=new Set<string>();classList={add:(name:string)=>this.classes.add(name),remove:(name:string)=>this.classes.delete(name)};
  constructor(readonly kind='text'){}
  appendChild(child:Element){child.remove();this.children.push(child);child.parentElement=this;return child;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  closest(selector:string):Element|null {return selector.startsWith('.callout')?this.kind==='fold'?this:this.parentElement?.closest(selector)??null:this.className==='send-to-t3-stream-stop'?this:this.parentElement?.closest(selector)??null;}
  setAttribute(name:string,value:string){this.attrs.set(name,value);}
}
function fixture(stop:(target:StreamStopTarget)=>Promise<void>=async()=>{}){
  const savedObserver=globalThis.MutationObserver;let mutated=()=>{};
  (globalThis as any).MutationObserver=class {constructor(callback:()=>void){mutated=callback;}observe(){}disconnect(){}};
  const root=new EventTarget() as any;root.body=new Element('body');root.querySelectorAll=()=>folds;root.createElement=()=>new Element('button');
  const folds=[new Element('fold'),new Element('fold')],view={} as any,targets=new Map(folds.map((fold,i)=>[fold,{id:i?other:id,key:`${i}:active`,view}]));
  for(const fold of folds)root.body.appendChild(fold);
  const errors:unknown[]=[],calls:StreamStopTarget[]=[];
  const dispose=installStreamStopControls(root,fold=>targets.get(fold as any),async target=>{calls.push(target);await stop(target);},(button,name)=>{assert.equal(name,'square');button.setAttribute('data-icon',name);},error=>errors.push(error));
  const fire=(type:string,target:Element)=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'target',{value:target});root.dispatchEvent(event);return event;};
  const flush=async()=>{mutated();await new Promise(resolve=>setImmediate(resolve));};
  return {root,folds,targets,view,errors,calls,fire,flush,button:(i=0)=>folds[i].children.find(child=>child.className==='send-to-t3-stream-stop')!,dispose:()=>{dispose();globalThis.MutationObserver=savedObserver;}};
}
test('click, touch-generated click and keyboard focus reveal only their box without cancelling links or selection',async()=>{
  const h=fixture();try{
    assert.equal(h.button().hidden,true);assert.equal(h.button(1).hidden,true);
    const link=new Element('link');h.folds[0].appendChild(link);
    for(const type of ['pointerdown','mousedown','pointerup'])assert.equal(h.fire(type,link).defaultPrevented,false);
    assert.equal(h.button().hidden,true,'The first pointer cannot land on a newly inserted Stop');
    let otherListener=0;h.root.addEventListener('click',()=>otherListener++);
    assert.equal(h.fire('click',link).defaultPrevented,false);assert.equal(otherListener,1,'Link/title handlers still receive the click');
    assert.equal(h.calls.length,0);assert.equal(h.button().hidden,false);assert.equal(h.button(1).hidden,true);
    assert.equal(h.button().attrs.get('aria-label'),'Stop T3 response');
    h.fire('focusin',h.folds[1]);assert.equal(h.button(1).hidden,false);
    const replacement=new Element('fold');h.root.body.appendChild(replacement);h.targets.set(replacement,h.targets.get(h.folds[0])!);h.targets.delete(h.folds[0]);h.folds[0]=replacement;await h.flush();
    assert.equal(h.button().hidden,false,'Token replacement preserves revealed state in the same pane');
    h.targets.set(replacement,{id,key:'different-run:active',view:h.view});await h.flush();assert.equal(h.button().hidden,true);
  }finally{h.dispose();}
});
test('Stop is single-flight and selects the exact box; terminal and stale controls cannot stop another run',async()=>{
  let finish=()=>{};const h=fixture(()=>new Promise<void>(resolve=>{finish=resolve;}));try{
    h.fire('click',h.folds[0]);const button=h.button();
    assert.equal(h.fire('click',button).defaultPrevented,true);h.fire('click',button);await h.flush();
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].id,id);assert.equal(button.disabled,true);assert.equal(h.button(1).disabled,false);
    h.targets.delete(h.folds[0]);await h.flush();assert.equal(button.parentElement,null,'Completed or stopped boxes lose the control');
    h.fire('click',button);assert.equal(h.calls.length,1);finish();await h.flush();
    h.fire('click',h.folds[1]);const stale=h.button(1);h.fire('click',stale);
    h.targets.set(h.folds[1],{id:other,key:'next:active',view:h.view});await h.flush();
    assert.equal(h.calls.length,1,'A run replaced before dispatch cannot receive the old click');
    assert.equal(h.button(1).hidden,true);
  }finally{finish();h.dispose();}
});
test('a stop failure is reported and can be retried; disposal removes controls and listeners',async()=>{
  const h=fixture(async()=>{throw Error('stop failed');});
  h.fire('focusin',h.folds[0]);const button=h.button();h.fire('click',button);await h.flush();
  assert.equal(h.errors.length,1);assert.equal(button.disabled,false);h.fire('click',button);await h.flush();assert.equal(h.errors.length,2);
  h.dispose();assert.equal(button.parentElement,null);assert.equal(h.folds[0].classes.size,0);h.fire('click',h.folds[0]);assert.equal(h.calls.length,2);
});
