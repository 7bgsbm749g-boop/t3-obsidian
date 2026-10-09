import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {ResponseScroll} from '../response-scroll';
import {projectResponses,responseAnchor} from '../native-response-projection';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const key='thread:active',otherKey='other:active';
const body=(key:string,text='First paragraph')=>`> [!t3-progress]+ Working <span class="send-to-t3-fold-key" data-t3-fold="${key}"></span>\n>\n> ${text}`;
function fixture(){
  let mode='source',selected=false,live=true;
  const handlers=new Map<string,Set<(event:any)=>void>>(),frames=new Map<number,()=>void>();let sequence=0;
  const window={getSelection:()=>({isCollapsed:!selected}),addEventListener:(type:string,fn:any)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type)!.add(fn);},removeEventListener:(type:string,fn:any)=>handlers.get(type)?.delete(fn),requestAnimationFrame:(fn:()=>void)=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:(id:number)=>frames.delete(id)};
  const saved=`Before\n\n${responseAnchor(id)}\n\nBetween\n\n${responseAnchor(other)}\n\nAfter`;
  let responses=[{id,body:body(key)},{id:other,body:body(otherKey)}],projection=projectResponses(saved,responses);
  const fold=(key:string)=>({getBoundingClientRect:()=>({bottom:1100}),querySelector:()=>({dataset:{t3Fold:key}})});
  const folds=[fold(key),fold(otherKey)],scroller={scrollTop:200,getBoundingClientRect:()=>({bottom:700}),querySelectorAll:()=>folds};
  const target=(kind:'response'|'other'|'outside'|'control'|'source'='response')=>({nodeType:1,kind,closest:(selector:string)=>selector.startsWith('a,')?kind==='control'?{}:null:kind==='response'?folds[0]:kind==='other'?folds[1]:null});
  let position=projection.ranges[0].displayFrom+70;const effects:any[]=[];
  const cm={contentDOM:{contains:(el:any)=>el.kind==='source'},state:EditorState.create({doc:projection.display}),posAtCoords:()=>position,dispatch:(spec:any)=>effects.push(spec)};
  const contentEl={ownerDocument:{defaultView:window},isConnected:true,contains:(el:any)=>el.kind!=='outside',querySelector:(selector:string)=>selector.includes('is-live-preview')?live?{}:null:scroller};
  const view:any={contentEl,editor:{cm},getMode:()=>mode};
  const scroll=new ResponseScroll(view,()=>projection);
  const event=(type:string,kind:Parameters<typeof target>[0]='response',extra:any={})=>{for(const fn of handlers.get(type)??[])fn({isTrusted:true,button:0,target:target(kind),...extra});};
  const update=(binding=id,text='New response tail')=>{responses=responses.map(response=>response.id===binding?{id:binding,body:body(binding===id?key:otherKey,text)}:response);projection=projectResponses(saved,responses);cm.state=EditorState.create({doc:projection.display});scroll.updated();};
  const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
  return {scroll,view,event,update,flush,effects,frames,handlers,scroller,projection:()=>projection,position:(value:number)=>{position=value;},mode:(value:string)=>{mode=value;},live:(value:boolean)=>{live=value;},selected:(value:boolean)=>{selected=value;},remove:()=>{projection=projectResponses(saved,[]);scroll.updated();}};
}
test('stream updates, source cursor proximity and synthetic fold clicks cannot enable following',()=>{
  const h=fixture();h.update();h.flush();assert.equal(h.effects.length,0);
  h.event('click','response',{isTrusted:false});h.update(id,'More');h.flush();assert.equal(h.effects.length,0);h.scroll.dispose();
});
test('a real section click follows only that response, without moving selection or editing history',()=>{
  const h=fixture();h.event('click');h.update(other);h.flush();assert.equal(h.effects.length,0);
  h.update();h.flush();assert.equal(h.effects.length,1);assert.deepEqual(Object.keys(h.effects[0]),['effects']);
  const range=h.projection().ranges[0];assert.equal(h.effects[0].effects.value.range.head,h.projection().display.lastIndexOf('\n',range.displayTo-1)-1);h.scroll.dispose();
});
test('manual scrolling cancels queued following and returning to the bottom cannot re-enable it',()=>{
  for(const type of ['wheel','touchmove','keydown']){
    const h=fixture();h.event('click');h.update();assert.equal(h.frames.size,1);h.event(type,'response',{key:'PageUp'});h.flush();assert.equal(h.effects.length,0);
    h.event('scroll');h.update(id,'At the bottom again');h.flush();assert.equal(h.effects.length,0);
    h.event('click');h.update(id,'Clicked again');h.flush();assert.equal(h.effects.length,1);h.scroll.dispose();
  }
});
test('outside clicks and native response controls disable following, while programmatic scroll events do not',()=>{
  for(const kind of ['outside','control'] as const){const h=fixture();h.event('click');h.update();h.event('click',kind);h.flush();assert.equal(h.effects.length,0);h.scroll.dispose();}
  const h=fixture();h.event('click');h.event('scroll');h.update();h.flush();assert.equal(h.effects.length,1);h.scroll.dispose();
});
test('switching response sections transfers following to the clicked identity',()=>{
  const h=fixture();h.event('click');h.event('click','other');h.update();h.flush();assert.equal(h.effects.length,0);h.update(other);h.flush();assert.equal(h.effects.length,1);h.scroll.dispose();
});
test('Source mode resolves the clicked response by document position, without arming outside ranges',()=>{
  const h=fixture();h.live(false);h.event('click','source');h.update();h.flush();assert.equal(h.effects.length,1);
  h.position(0);h.event('click','source');h.update(id,'Next');h.flush();assert.equal(h.effects.length,1);h.scroll.dispose();
});
test('Reading follows the clicked fold, with no automatic default and no selection takeover',()=>{
  const h=fixture();h.mode('preview');h.update();h.flush();assert.equal(h.scroller.scrollTop,200);
  h.event('click');h.update(id,'Reading tail');h.flush();assert.equal(h.scroller.scrollTop,632);
  h.selected(true);h.update(id,'Selected text');h.flush();assert.equal(h.scroller.scrollTop,632);h.selected(false);h.update(id,'Selection ended');h.flush();assert.equal(h.scroller.scrollTop,632);h.scroll.dispose();
});
test('completion, mode changes, conflicts and disposal cancel pending scroll work',()=>{
  for(const stop of ['completion','mode','conflict','dispose'] as const){const h=fixture();h.event('click');h.update();
    if(stop==='completion')h.remove();else if(stop==='mode'){h.mode('preview');h.scroll.updated();}else if(stop==='conflict')h.scroll.suspend();else h.scroll.dispose();
    h.flush();assert.equal(h.effects.length,0);h.scroll.dispose();assert.ok([...h.handlers.values()].every(set=>set.size===0));
  }
});
