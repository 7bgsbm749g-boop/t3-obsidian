import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {ResponseScroll} from '../response-scroll';
import {projectResponses,responseAnchor} from '../native-response-projection';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const key='thread:active',otherKey='other:active';
const body=(key:string,text='First paragraph')=>`> [!t3-progress]+ Working <span class="send-to-t3-fold-key" data-t3-fold="${key}"></span>\n>\n> ${text}`;
function fixture(){
  let mode='source',selected=false,live=true,rendered=true,reduced=true,time=0,tail=1100;
  const handlers=new Map<string,Set<(event:any)=>void>>(),frames=new Map<number,(time:number)=>void>();let sequence=0;
  const add=(type:string,fn:any)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type)!.add(fn);};
  const remove=(type:string,fn:any)=>handlers.get(type)?.delete(fn);
  const window={Event:class{constructor(public type:string){}},getSelection:()=>({isCollapsed:!selected,anchorNode:{kind:'response'}}),addEventListener:add,removeEventListener:remove,matchMedia:()=>({matches:reduced}),requestAnimationFrame:(fn:(time:number)=>void)=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:(id:number)=>frames.delete(id),visualViewport:{offsetTop:0,height:900,addEventListener:add,removeEventListener:remove}};
  const saved=`Before\n\n${responseAnchor(id)}\n\nBetween\n\n${responseAnchor(other)}\n\nAfter`;
  let responses=[{id,body:body(key)},{id:other,body:body(otherKey)}],projection=projectResponses(saved,responses);
  const scroller={scrollTop:200,clientTop:0,clientHeight:600,getBoundingClientRect:()=>({top:100,bottom:700}),querySelectorAll:()=>rendered?folds:[]};
  const fold=(key:string)=>({getBoundingClientRect:()=>({bottom:tail-(scroller.scrollTop-200),left:100,right:700}),querySelector:()=>({dataset:{t3Fold:key}})});
  const folds=[fold(key),fold(otherKey)];
  const target=(kind:'response'|'outside'|'control'|'follow'='response')=>({nodeType:1,kind,closest:(selector:string)=>selector==='.send-to-t3-stream-follow'&&kind==='follow'?{}:null});
  const effects:any[]=[],notifications:any[]=[];
  const cm={scrollDOM:scroller,state:EditorState.create({doc:projection.display}),dispatch:(spec:any)=>effects.push(spec)};
  const document={defaultView:window,addEventListener:add,removeEventListener:remove,querySelectorAll:()=>[] as any[]};
  const contentEl={ownerDocument:document,isConnected:true,contains:(el:any)=>el?.kind!=='outside',querySelector:(selector:string)=>selector.includes('is-live-preview')?live?{}:null:scroller,querySelectorAll:()=>rendered?folds:[],getBoundingClientRect:()=>({bottom:800}),dispatchEvent:(event:any)=>{notifications.push(event);return true;}};
  const view:any={contentEl,editor:{cm},getMode:()=>mode};
  const scroll=new ResponseScroll(view,()=>projection);
  const event=(type:string,kind:Parameters<typeof target>[0]='response',extra:any={})=>{for(const fn of handlers.get(type)??[])fn({isTrusted:true,button:0,target:target(kind),...extra});};
  const update=(binding=id,text='New response tail')=>{responses=responses.map(response=>response.id===binding?{id:binding,body:body(binding===id?key:otherKey,text)}:response);projection=projectResponses(saved,responses);cm.state=EditorState.create({doc:projection.display});scroll.updated();};
  const flush=(at=time+=16)=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(at);};
  return {scroll,view,event,update,flush,effects,frames,handlers,scroller,notifications,mode:(value:string)=>{mode=value;},selected:(value:boolean)=>{selected=value;},rendered:(value:boolean)=>{rendered=value;},reduced:(value:boolean)=>{reduced=value;},grow:(pixels:number)=>{tail+=pixels;scroll.updated();},remove:()=>{projection=projectResponses(saved,[]);scroll.updated();}};
}
test('stream updates and text or synthetic clicks never enable follow',()=>{
  const h=fixture();h.update();h.event('click');h.event('click','follow',{isTrusted:false});h.flush();assert.equal(h.scroller.scrollTop,200);assert.deepEqual(h.scroll.control(key),{active:false,position:'top',moving:false});h.scroll.dispose();
});
test('explicit activation aligns immediately without waiting for another response update or changing editor state',()=>{
  const h=fixture(),before=h.view.editor.cm.state;h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,608);assert.equal(h.view.editor.cm.state,before);assert.equal(h.effects.length,0);assert.deepEqual(h.scroll.control(key),{active:true,position:'bottom',moving:false});h.scroll.dispose();
});
test('large rendered widgets and layout-only growth keep their bottom aligned',()=>{
  const h=fixture();h.scroll.toggle(key);h.flush();h.grow(2400);h.flush();assert.equal(h.scroller.scrollTop,3008);h.scroll.dispose();
});
test('activation animates to the current target, including growth during the trip',()=>{
  const h=fixture();h.reduced(false);h.scroll.toggle(key);h.flush(0);assert.equal(h.scroller.scrollTop,200);h.flush(210);assert.ok(h.scroller.scrollTop>200&&h.scroller.scrollTop<608);h.grow(500);h.flush(420);assert.equal(h.scroller.scrollTop,1108);assert.equal(h.frames.size,0);h.scroll.dispose();
});
test('every explicit off returns to the top and preserves the current viewport through further growth',()=>{
  const h=fixture();
  for(let cycle=0;cycle<3;cycle++){
    h.scroll.toggle(key);h.flush();assert.deepEqual(h.scroll.control(key),{active:true,position:'bottom',moving:false});
    const top=h.scroller.scrollTop;h.scroll.toggle(key);assert.deepEqual(h.scroll.control(key),{active:false,position:'top',moving:false});
    h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,top);
  }
  h.scroll.dispose();
});
test('manual scroll, editing, selection and outside pointer cancel pending follow',()=>{
  for(const type of ['wheel','touchmove','keydown','selectionchange','pointerdown','click']){const h=fixture();h.scroll.toggle(key);if(type==='selectionchange')h.selected(true);h.event(type,type==='pointerdown'?'outside':'response',{key:'PageUp'});h.flush();assert.equal(h.scroller.scrollTop,200);assert.equal(h.scroll.control(key)?.active,false);h.event('scroll');h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,200);h.scroll.dispose();}
});
test('follow button pointer and keyboard input do not cancel before the button can toggle',()=>{
  const h=fixture();h.scroll.toggle(key);h.event('pointerdown','follow');h.event('keydown','follow',{key:' '});h.event('click','follow');h.flush();assert.equal(h.scroll.control(key)?.active,true);assert.equal(h.scroller.scrollTop,608);h.scroll.dispose();
});
test('manual scroll keys still cancel follow when the follow button has focus',()=>{
  const h=fixture();h.scroll.toggle(key);h.event('keydown','follow',{key:'PageUp'});h.flush();assert.equal(h.scroller.scrollTop,200);assert.equal(h.scroll.control(key)?.active,false);h.scroll.dispose();
});
test('another response cannot follow until its own explicit activation',()=>{
  const h=fixture();h.scroll.toggle(key);h.flush();h.scroll.toggle(otherKey);assert.equal(h.scroll.control(key)?.active,false);assert.equal(h.scroll.control(otherKey)?.active,true);h.scroll.dispose();
});
test('Reading uses its pane scroller and visible viewport, and selection cancels it',()=>{
  const h=fixture();h.mode('preview');h.view.contentEl.ownerDocument.defaultView.visualViewport.height=650;h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,658);h.selected(true);h.grow(800);h.flush();assert.equal(h.scroller.scrollTop,658);assert.equal(h.scroll.control(key)?.active,false);h.scroll.dispose();
});
test('hidden widgets from another native mode cannot supply the scroll target',()=>{
  const h=fixture();h.mode('preview');h.view.contentEl.querySelectorAll=()=>[{getBoundingClientRect:()=>({bottom:0}),querySelector:()=>({dataset:{t3Fold:key}})}];h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,608);h.scroll.dispose();
});
test('an overlapping Obsidian status bar reduces the visible bottom; a bar beside the pane does not',()=>{
  for(const [left,expected] of [[500,628],[800,608]]){const h=fixture();h.view.contentEl.ownerDocument.querySelectorAll=()=>[{getBoundingClientRect:()=>({top:680,bottom:700,left,right:left+200,width:200,height:20})}];h.scroll.toggle(key);h.flush();assert.equal(h.scroller.scrollTop,expected);h.scroll.dispose();}
});
test('a virtualized native block is revealed with a scroll effect before rendered geometry is used',()=>{
  const h=fixture();h.rendered(false);h.scroll.toggle(key);h.flush();assert.equal(h.effects.length,1);assert.deepEqual(Object.keys(h.effects[0]),['effects']);h.rendered(true);h.scroll.updated();h.flush();assert.equal(h.scroller.scrollTop,608);h.scroll.dispose();
});
test('completed, duplicate or unknown fold identities cannot enable follow',()=>{
  const h=fixture();h.scroll.toggle('thread:complete');h.scroll.toggle('unknown:active');h.flush();assert.equal(h.scroller.scrollTop,200);assert.equal(h.scroll.control('thread:complete'),undefined);h.scroll.dispose();
});
test('completion, mode changes, conflicts and disposal cancel work and clean listeners',()=>{
  for(const stop of ['completion','mode','conflict','dispose'] as const){const h=fixture();h.scroll.toggle(key);if(stop==='completion')h.remove();else if(stop==='mode'){h.mode('preview');h.scroll.updated();}else if(stop==='conflict')h.scroll.suspend();else h.scroll.dispose();h.flush();assert.equal(h.scroller.scrollTop,200);h.scroll.dispose();assert.ok([...h.handlers.values()].every(set=>set.size===0));}
});
