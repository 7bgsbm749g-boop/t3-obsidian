import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {EventJournal,configureDiagnostics,connectionDiagnosticPolicy} from '../src/app/diagnostics';
import {ResponseScroll,type ResponseScrollState} from '../src/responses/response-scroll';
import {projectResponses,responseAnchor,type LocalResponse} from '../src/responses/native-response-projection';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const key='thread:active',otherKey='other:active';
const body=(key:string,text='First paragraph')=>`> [!t3-progress]+ Working <span class="send-to-t3-fold-key" data-t3-fold="${key}"></span>\n>\n> ${text}`;
function fixture(state?:ResponseScrollState){
  let mode='source',selected=false,live=true,rendered=true,reduced=true,time=0,tail=1100;
  const handlers=new Map<string,Set<(event:any)=>void>>(),frames=new Map<number,(time:number)=>void>();let sequence=0;
  let mutations:((records:any[])=>void)|undefined,observed:MutationObserverInit|undefined;
  const add=(type:string,fn:any)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type)!.add(fn);};
  const remove=(type:string,fn:any)=>handlers.get(type)?.delete(fn);
  const window={MutationObserver:class{constructor(callback:(records:any[])=>void){mutations=callback;}observe(_target:any,options:MutationObserverInit){observed=options;}disconnect(){mutations=undefined;}},Event:class{constructor(public type:string){}},getSelection:()=>({isCollapsed:!selected,anchorNode:{kind:'response'}}),addEventListener:add,removeEventListener:remove,matchMedia:()=>({matches:reduced}),requestAnimationFrame:(fn:(time:number)=>void)=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:(id:number)=>frames.delete(id),visualViewport:{offsetTop:0,height:900,addEventListener:add,removeEventListener:remove}};
  const saved=`Before\n\n${responseAnchor(id)}\n\nBetween\n\n${responseAnchor(other)}\n\nAfter`;
  let responses:LocalResponse[]=[{id,body:body(key)},{id:other,body:body(otherKey)}],projection=projectResponses(saved,responses);
  const scroller={scrollTop:200,scrollLeft:0,clientTop:0,clientLeft:0,clientWidth:600,clientHeight:600,contains:(el:any)=>el?.kind!=='outside',getBoundingClientRect:()=>({top:100,bottom:700,left:100,right:700}),querySelectorAll:(selector:string)=>rendered?folds.filter(fold=>!selector.includes('is-collapsed')||fold.collapsed):[]};
  const fold=(key:string)=>({collapsed:false,get classList(){return {contains:(name:string)=>name==='is-collapsed'&&this.collapsed};},matches:(selector:string)=>selector==='.callout[data-callout="t3-progress"]',getBoundingClientRect:()=>({bottom:tail-(scroller.scrollTop-200),left:100,right:700}),querySelector:()=>({dataset:{t3Fold:key}})});
  const folds=[fold(key),fold(otherKey)];
  const target=(kind:'response'|'outside'|'control'|'follow'='response')=>({nodeType:1,kind,closest:(selector:string)=>kind==='follow'&&(selector==='.send-to-t3-stream-follow'||selector.includes('button'))?{}:null});
  const effects:any[]=[],notifications:any[]=[];
  const cm={scrollDOM:scroller,documentTop:0,scaleY:1,lineBlockAt:()=>({bottom:tail-(scroller.scrollTop-200)}),state:EditorState.create({doc:projection.display}),dispatch:(spec:any)=>effects.push(spec)};
  const document={defaultView:window,addEventListener:add,removeEventListener:remove,querySelectorAll:()=>[] as any[]};
  const contentEl={ownerDocument:document,isConnected:true,contains:(el:any)=>el?.kind!=='outside',querySelector:(selector:string)=>selector.includes('is-live-preview')?live?{}:null:scroller,querySelectorAll:(selector:string)=>rendered?folds.filter(fold=>!selector.includes('is-collapsed')||fold.collapsed):[],getBoundingClientRect:()=>({bottom:800}),dispatchEvent:(event:any)=>{notifications.push(event);return true;}};
  const view:any={file:{path:'Response.md'},contentEl,editor:{cm},getMode:()=>mode};
  const scroll=new ResponseScroll(view,()=>projection,state);
  const event=(type:string,kind:Parameters<typeof target>[0]='response',extra:any={})=>{for(const fn of handlers.get(type)??[])fn({type,isTrusted:true,button:0,...(type==='wheel'?{deltaY:1}:{}),target:target(kind),...extra});};
  const update=(binding=id,text='New response tail')=>{responses=responses.map(response=>response.id===binding?{id:binding,body:body(binding===id?key:otherKey,text)}:response);projection=projectResponses(saved,responses);cm.state=EditorState.create({doc:projection.display});scroll.updated();};
  const flush=(at=time+=16)=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(at);};
  return {scroll,view,event,update,flush,effects,frames,handlers,scroller,notifications,connection:(paused:boolean)=>{responses=responses.map(response=>({...response,followPaused:paused}));projection=projectResponses(saved,responses);scroll.updated();},observed:()=>observed,terminal:()=>{responses=responses.map(response=>response.id===id?{...response,followable:false}:response);projection=projectResponses(saved,responses);scroll.updated();},collapse:(index=0,value=true)=>{folds[index].collapsed=value;mutations?.([{type:'attributes',attributeName:'class',target:folds[index]}]);},mode:(value:string)=>{mode=value;},selected:(value:boolean)=>{selected=value;},rendered:(value:boolean)=>{rendered=value;},reduced:(value:boolean)=>{reduced=value;},grow:(pixels:number)=>{tail+=pixels;scroll.updated();},remove:()=>{projection=projectResponses(saved,[]);scroll.updated();}};
}
test('interruption cancels a pending follow frame even when its active key and preview text are unchanged',()=>{
 const state:ResponseScrollState={positions:new Map()},h=fixture(state);h.reduced(false);h.scroll.toggle(key);assert.ok(h.frames.size);
 h.terminal();assert.equal(h.scroll.control(key),undefined);assert.equal(state.following,undefined);assert.equal(h.frames.size,0);
 h.scroll.toggle(key);h.grow(100);h.flush();assert.equal(h.scroller.scrollTop,200);assert.ok(h.scroll.control(otherKey));h.scroll.dispose();
});

test('Follow diagnostics distinguish a reconnect pause, recovery and explicit user scrolling without frame logs',async()=>{
 const journal=new EventJournal({load:async()=>undefined,save:async()=>{},id:()=> 'client',context:{deviceId:'phone'}},{...connectionDiagnosticPolicy,accept:event=>event==='response.follow.changed'});
 configureDiagnostics(journal);const h=fixture();
 try{
  h.scroll.toggle(key);h.flush();h.connection(true);h.flush();
  for(let n=0;n<8;n++){h.scroll.updated();h.flush();}
  assert.equal(h.scroll.control(key)?.active,true);assert.equal(journal.snapshot().events.length,2);
  h.connection(false);h.flush();h.event('wheel');h.flush();
  const fields=journal.snapshot().events.map(event=>event.fields);
  assert.deepEqual(fields.map(row=>[row.to,row.reason]),[['following','button-on'],['paused','reconnecting'],['following','projection-ready'],['off','manual-wheel']]);
  assert.ok(fields.every(row=>row.bindingId===id));assert.equal(fields[1].retained,true);assert.equal(fields[3].retained,false);assert.doesNotMatch(journal.export(),/Response\.md|First paragraph/);
 }finally{h.scroll.dispose();configureDiagnostics();await journal.close();}
});
test('stream updates and text or synthetic clicks never enable follow',()=>{
  const h=fixture();h.update();h.event('click');h.event('click','follow',{isTrusted:false});h.flush();assert.equal(h.scroller.scrollTop,200);assert.deepEqual(h.scroll.control(key),{active:false,position:'bottom',moving:false});h.scroll.dispose();
});
test('inactive scroll helpers never force layout during native viewport mutations',()=>{
 const h=fixture();
 h.view.contentEl.getClientRects=()=>assert.fail('Inactive history must not force a layout read');
 h.scroller.querySelectorAll=()=>assert.fail('Inactive history must not scan rendered folds');
 h.scroll.updated();h.collapse();h.flush();h.event('wheel');h.update();h.flush();
 assert.equal(h.frames.size,0);assert.equal(h.scroller.scrollTop,200);h.scroll.dispose();
});
test('explicit activation aligns immediately without waiting for another response update or changing editor state',()=>{
  const h=fixture(),before=h.view.editor.cm.state;h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,608);assert.equal(h.view.editor.cm.state,before);assert.equal(h.effects.length,0);assert.deepEqual(h.scroll.control(key),{active:true,position:'bottom',moving:false});h.scroll.dispose();
});
test('a visible stream grows into spare space before follow scrolls, and shrinkage never pulls the reader up',()=>{
  const h=fixture();h.grow(-600);h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,200);
  h.grow(100);h.flush();assert.equal(h.scroller.scrollTop,200);
  h.grow(200);h.flush();assert.equal(h.scroller.scrollTop,308);
  h.grow(2400);h.flush();assert.equal(h.scroller.scrollTop,2708);
  h.grow(-500);h.flush();assert.equal(h.scroller.scrollTop,2708);h.scroll.dispose();
});
test('activation animates to the current target, including growth during the trip',()=>{
  const h=fixture();h.reduced(false);h.scroll.toggle(key);h.flush(0);assert.equal(h.scroller.scrollTop,200);h.flush(210);assert.ok(h.scroller.scrollTop>200&&h.scroller.scrollTop<608);h.grow(500);h.flush(420);assert.equal(h.scroller.scrollTop,1108);assert.equal(h.frames.size,0);h.scroll.dispose();
});
test('explicit off retains the bottom position and preserves the current viewport through further growth',()=>{
  const h=fixture();
  for(let cycle=0;cycle<3;cycle++){
    h.scroll.toggle(key);h.flush();assert.deepEqual(h.scroll.control(key),{active:true,position:'bottom',moving:false});
    const top=h.scroller.scrollTop;h.scroll.toggle(key);assert.deepEqual(h.scroll.control(key),{active:false,position:'bottom',moving:false});
    h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,top);
  }
  h.scroll.dispose();
});
test('collapsing cancels pending follow and keeps the footer button inactive when reopened',()=>{
  for(const mode of ['source','preview']){
    const h=fixture();h.mode(mode);h.reduced(false);h.scroll.toggle(key);h.flush(0);
    assert.equal(h.observed()?.attributes,true);assert.deepEqual(h.observed()?.attributeFilter,['class']);
    h.collapse();h.flush();assert.equal(h.frames.size,0);assert.deepEqual(h.scroll.control(key),{active:false,position:'bottom',moving:false});
    const top=h.scroller.scrollTop;h.collapse(0,false);h.grow(800);h.flush();
    assert.equal(h.scroller.scrollTop,top);assert.deepEqual(h.scroll.control(key),{active:false,position:'bottom',moving:false});h.scroll.dispose();
  }
});
test('collapsing another response leaves the active response following',()=>{
  const h=fixture();h.scroll.toggle(key);h.flush();h.event('wheel');
  assert.deepEqual(h.scroll.control(key),{active:false,position:'bottom',moving:false});
  h.scroll.toggle(otherKey);h.flush();const top=h.scroller.scrollTop,notifications=h.notifications.length;
  h.collapse();h.flush();assert.equal(h.notifications.length,notifications);assert.deepEqual(h.scroll.control(key),{active:false,position:'bottom',moving:false});
  assert.deepEqual(h.scroll.control(otherKey),{active:true,position:'bottom',moving:false});
  h.collapse(0,false);h.flush();assert.equal(h.scroller.scrollTop,top);assert.equal(h.scroll.control(key)?.position,'bottom');h.scroll.dispose();
});
test('wheel and touch scroll cancel pending follow and preserve its button position',()=>{
  for(const type of ['wheel','touchmove']){const h=fixture();h.scroll.toggle(key);h.event(type);h.flush();assert.equal(h.scroller.scrollTop,200);assert.deepEqual(h.scroll.control(key),{active:false,position:'bottom',moving:false});h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,200);h.scroll.dispose();}
});
test('app clicks, pointer input, typing and text selection retain follow',()=>{
  for(const type of ['click','pointerdown','keydown','beforeinput','selectionchange'])for(const kind of ['response','outside'] as const){
    const h=fixture();h.scroll.toggle(key);h.selected(true);h.event(type,kind,{key:'a'});h.flush();
    assert.equal(h.scroll.control(key)?.active,true);assert.equal(h.scroller.scrollTop,608);h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,1408);h.scroll.dispose();
  }
});
test('native scroll events from follow keep it active; scrollbar or keyboard scrolling disables it',()=>{
  const h=fixture();h.scroll.toggle(key);h.flush();h.event('scroll','response',{target:h.scroller});
  assert.equal(h.scroll.control(key)?.active,true);
  h.scroller.scrollTop-=100;h.event('scroll','response',{target:h.scroller});assert.equal(h.scroll.control(key)?.active,true);
  h.event('pointerdown','response',{target:h.scroller,clientX:710});
  assert.deepEqual(h.scroll.control(key),{active:false,position:'bottom',moving:false});const top=h.scroller.scrollTop;
  h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,top);h.scroll.dispose();
});
test('note navigation retains active follow and restores it with a fresh controller',()=>{
  const state:ResponseScrollState={positions:new Map()},h=fixture(state);h.scroll.toggle(key);h.flush();
  h.view.file={path:'Another note.md'};h.scroll.updated();h.event('wheel');h.scroll.dispose();
  assert.equal(h.frames.size,0);assert.equal(state.following?.key,key);
  const returned=fixture(state);returned.scroll.updated();returned.flush();
  assert.deepEqual(returned.scroll.control(key),{active:true,position:'bottom',moving:false});assert.equal(returned.scroller.scrollTop,608);
  returned.collapse();returned.flush();returned.scroll.dispose();
  const reopened=fixture(state);reopened.scroll.updated();reopened.flush();assert.deepEqual(reopened.scroll.control(key),{active:false,position:'bottom',moving:false});assert.equal(reopened.scroller.scrollTop,200);reopened.scroll.dispose();
});
test('an editor detached during a pending frame pauses without losing follow intent',()=>{
  const h=fixture();h.scroll.toggle(key);h.view.contentEl.isConnected=false;h.flush();
  assert.equal(h.frames.size,0);assert.equal(h.scroll.control(key)?.active,true);assert.equal(h.scroller.scrollTop,200);
  h.view.contentEl.isConnected=true;h.scroll.updated();h.flush();assert.equal(h.scroll.control(key)?.active,true);assert.equal(h.scroller.scrollTop,608);h.scroll.dispose();
});
test('follow button pointer and keyboard input do not cancel before the button can toggle',()=>{
  const h=fixture();h.scroll.toggle(key);h.event('pointerdown','follow');h.event('keydown','follow',{key:' '});h.event('click','follow');h.flush();assert.equal(h.scroll.control(key)?.active,true);assert.equal(h.scroller.scrollTop,608);h.scroll.dispose();
});
test('a scroll key disables follow when it scrolls the pane, including with the button focused',()=>{
  const h=fixture();h.scroll.toggle(key);h.flush();h.event('keydown','follow',{key:'PageUp'});h.scroller.scrollTop-=100;h.event('scroll','response',{target:h.scroller});h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,508);assert.equal(h.scroll.control(key)?.active,false);h.scroll.dispose();
});
test('another response cannot follow until its own explicit activation',()=>{
  const h=fixture();h.scroll.toggle(key);h.flush();h.scroll.toggle(otherKey);assert.equal(h.scroll.control(key)?.active,false);assert.equal(h.scroll.control(otherKey)?.active,true);h.scroll.dispose();
});
test('Reading uses its pane scroller and visible viewport, and selection retains follow',()=>{
  const h=fixture();h.mode('preview');h.view.contentEl.ownerDocument.defaultView.visualViewport.height=650;h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,658);h.selected(true);h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,1458);assert.equal(h.scroll.control(key)?.active,true);h.scroll.dispose();
});
test('hidden widgets from another native mode cannot supply the scroll target',()=>{
  const h=fixture();h.mode('preview');h.view.contentEl.querySelectorAll=(selector:string)=>selector.includes('is-collapsed')?[]:[{getBoundingClientRect:()=>({bottom:0}),querySelector:()=>({dataset:{t3Fold:key}})}] as any;h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,608);h.scroll.dispose();
});
test('an overlapping Obsidian status bar reduces the visible bottom; a bar beside the pane does not',()=>{
  for(const [left,expected] of [[500,628],[800,608]]){const h=fixture();h.view.contentEl.ownerDocument.querySelectorAll=()=>[{getBoundingClientRect:()=>({top:680,bottom:700,left,right:left+200,width:200,height:20})}];h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,expected);h.scroll.dispose();}
});
test('a missing native block never scrolls to its temporary source estimate',()=>{
  const h=fixture();h.rendered(false);h.scroll.toggle(key);h.flush();assert.equal(h.effects.length,0);assert.equal(h.scroller.scrollTop,200);h.grow(4000);h.flush();assert.equal(h.effects.length,0);assert.equal(h.scroller.scrollTop,200);h.grow(-4000);h.flush();h.scroller.scrollTop+=50;h.event('scroll','response',{target:h.scroller});assert.equal(h.scroll.control(key)?.active,true);h.rendered(true);h.scroll.updated();h.flush();assert.equal(h.scroller.scrollTop,608);h.scroll.dispose();
});
test('completed, duplicate or unknown fold identities cannot enable follow',()=>{
  const h=fixture();h.scroll.toggle('thread:complete');h.scroll.toggle('unknown:active');h.flush();assert.equal(h.scroller.scrollTop,200);assert.equal(h.scroll.control('thread:complete'),undefined);h.scroll.dispose();
});
test('completion, mode changes, conflicts and disposal cancel work and clean listeners',()=>{
  for(const stop of ['completion','mode','conflict','dispose'] as const){const h=fixture();h.scroll.toggle(key);if(stop==='completion')h.remove();else if(stop==='mode'){h.mode('preview');h.scroll.updated();}else if(stop==='conflict')h.scroll.suspend();else h.scroll.dispose();h.flush();assert.equal(h.scroller.scrollTop,200);h.scroll.dispose();assert.ok([...h.handlers.values()].every(set=>set.size===0));}
});


test('a transient missing block during active Follow cannot jump ahead of the real stream',()=>{
  const h=fixture();h.grow(-600);h.scroll.toggle(key);h.flush();
  h.rendered(false);h.grow(20000);h.flush();assert.equal(h.scroller.scrollTop,200);assert.equal(h.effects.length,0);
  h.rendered(true);h.grow(-20000);h.flush();assert.equal(h.scroller.scrollTop,200);
  h.grow(200);h.flush();assert.equal(h.scroller.scrollTop,208);h.scroll.dispose();
});

test('status bars below or beside the pane never attract the response to their position',()=>{
  const h=fixture();h.grow(-600);h.view.contentEl.ownerDocument.querySelectorAll=()=>[{getBoundingClientRect:()=>({top:780,bottom:800,left:100,right:700,width:600,height:20})}];
  h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,200);
  h.grow(100);h.flush();assert.equal(h.scroller.scrollTop,200);h.scroll.dispose();
});
