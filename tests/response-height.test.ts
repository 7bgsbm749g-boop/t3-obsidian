import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ResponseHeightGuard,responseHeightAttribute,responseHeightProperty} from '../response-height';
import {heightFixture} from './fixtures/response-height';
import {EditorView} from '@codemirror/view';
import {StateEffect} from '@codemirror/state';

const display='> [!t3-progress]+ Working <span data-t3-fold="thread:active"></span>\n> Growing response';

test('a disappearing native widget cannot clamp the viewport to a temporary bottom',()=>{
  const h=heightFixture(),guard=new ResponseHeightGuard(h.view),selection=h.cm.state.selection;
  guard.begin(display);h.rendered(false);h.height(6500);guard.changed();h.advance(900);
  assert.equal(h.scroller.scrollTop,7000);assert.equal(h.scroller.scrollHeight,10000);assert.equal(h.guarded(),true);
  h.rendered(true);h.height(10600);guard.changed();h.advance(700);
  assert.equal(h.guarded(),false);assert.equal(h.scroller.scrollTop,7000);assert.equal(h.scroller.scrollHeight,10600);assert.equal(h.cm.state.selection,selection);assert.equal(h.jobs.size,0);
});

test('manual scrolling stays free while an incomplete native render retains its height',()=>{
  const h=heightFixture(),guard=new ResponseHeightGuard(h.view);guard.begin(display);h.rendered(false);h.height(6500);
  h.scroller.scrollTop=6200;guard.changed();h.advance(700);assert.equal(h.scroller.scrollTop,6200);
  h.scroller.scrollTop=7400;h.rendered(true);h.height(11000);guard.changed();h.advance(700);
  assert.equal(h.scroller.scrollTop,7400);assert.equal(h.guarded(),false);
});

test('an empty native viewport is recovered without scrolling or moving the selection',()=>{
  const h=heightFixture('Ordinary retained text'),guard=new ResponseHeightGuard(h.view),selection=h.cm.state.selection;let reveals=0;
  guard.begin(display);h.rendered(false);h.height(6500);
  h.cm.onDispatch=(spec:any)=>{if(spec.effects?.value?.range){reveals++;h.rendered(true);h.height(11000);guard.changed();}};
  h.advance(1400);assert.ok(reveals>0);assert.equal(h.scroller.scrollTop,7000);assert.equal(h.cm.state.selection,selection);assert.equal(h.guarded(),false);
  // The installed dormant handler must leave normal explicit scroll requests
  // available to CodeMirror after the guard has finished.
  const handlers=h.cm.state.facet(EditorView.scrollHandler),effect=EditorView.scrollIntoView(0,{y:'end',yMargin:8});
  assert.ok(handlers.every((handler:any)=>handler(h.cm,(effect.value as any).range,effect.value)===false));
});

test('guarded updates map the viewport through earlier growth and suppress only their own target',()=>{
  const h=heightFixture('Before and after'),guard=new ResponseHeightGuard(h.view);h.cm.viewport.from=12;
  const changes=h.cm.state.changes({from:0,insert:'A much longer earlier response. '});
  const effect=guard.begin(display,changes)!;
  assert.equal((effect.value as any).range.head,changes.mapPos(12,-1));
  const handlers=h.cm.state.facet(EditorView.scrollHandler),range=(effect.value as any).range;
  assert.ok(handlers.every((handler:any)=>handler(h.cm,range,{...effect.value as any,y:'end',yMargin:8})===false));
  assert.ok(handlers.some((handler:any)=>handler(h.cm,range,effect.value)===true));
  guard.clear();
  h.advance(6000);
  assert.ok(handlers.some((handler:any)=>handler(h.cm,range,effect.value)===true),'a delayed own request must remain suppressed after cancellation');
  assert.ok(handlers.every((handler:any)=>handler(h.cm,range,{...effect.value as any,xMargin:0})===false),'an ordinary request at the same source position must pass through');
});

test('background parsing and overlapping updates must settle before releasing the floor',()=>{
  const h=heightFixture(),guard=new ResponseHeightGuard(h.view);guard.begin(display);h.parsing(true);h.advance(900);assert.equal(h.guarded(),true);
  h.height(12000);guard.begin(display+'\n> More output');assert.equal(h.style.getPropertyValue(responseHeightProperty),'12000px');
  h.parsing(false);h.advance(300);assert.equal(h.guarded(),true);h.advance(400);assert.equal(h.guarded(),false);
});

test('a shorter projection can release its real height instead of retaining empty scroll space',()=>{
  const h=heightFixture('Before\n\nA long response\n\nAfter'),guard=new ResponseHeightGuard(h.view);
  guard.begin(display);h.rendered(false);h.height(6500);assert.equal(h.guarded(),true);
  const changes=h.cm.state.changes({from:8,to:24,insert:''});
  guard.begin(display,changes);assert.equal(h.guarded(),false);assert.equal(h.jobs.size,0);
  assert.equal(h.style.getPropertyValue(responseHeightProperty),'');
  guard.begin(display,changes);assert.equal(h.guarded(),false);
});

test('a virtualized widget does not cause unlimited polling and later DOM work can release its guard',()=>{
  const h=heightFixture(),guard=new ResponseHeightGuard(h.view);guard.begin(display);h.rendered(false);h.height(6500);h.advance(6000);
  assert.equal(h.jobs.size,0);assert.equal(h.guarded(),true);assert.equal(h.scroller.scrollTop,7000);
  h.rendered(true);h.height(10500);guard.changed();h.advance(700);assert.equal(h.guarded(),false);assert.equal(h.jobs.size,0);
});

test('manual reading elsewhere supplies the next viewport target without revealing an offscreen response',()=>{
  const h=heightFixture('Before and after'),guard=new ResponseHeightGuard(h.view);guard.begin(display);h.rendered(false);
  h.cm.viewport={from:3,to:7};let reveals=0;h.cm.onDispatch=()=>reveals++;
  h.advance(6000);assert.equal(reveals,0);assert.equal(h.jobs.size,0);
  assert.equal((guard.begin(display)!.value as any).range.head,3);
  guard.clear();
});

test('native editor reconfiguration does not lose suppression for later viewport-only requests',()=>{
  const h=heightFixture(),guard=new ResponseHeightGuard(h.view);guard.begin(display);
  h.cm.dispatch({effects:StateEffect.reconfigure.of([])});assert.equal(h.cm.state.facet(EditorView.scrollHandler).length,0);
  const effect=guard.begin(display)!;
  assert.ok(h.cm.state.facet(EditorView.scrollHandler).some((handler:any)=>handler(h.cm,(effect.value as any).range,effect.value)));
  guard.clear();
});

test('completion, note/mode changes, resize, disconnection and disposal release the temporary minimum',()=>{
  for(const change of ['completion','file','reading','source','width','height','disconnected','dispose']){
    const h=heightFixture(),guard=new ResponseHeightGuard(h.view);guard.begin(display);assert.equal(h.guarded(),true);
    if(change==='completion')guard.begin('Completed answer');
    if(change==='file')h.view.file={path:'Another note.md'};
    if(change==='reading')h.mode('preview');
    if(change==='source')h.live(false);
    if(change==='width')h.scroller.clientWidth=400;
    if(change==='height')h.scroller.clientHeight=400;
    if(change==='disconnected')h.content.isConnected=false;
    if(change==='dispose')guard.clear();
    h.advance(100);assert.equal(h.guarded(),false,change);assert.equal(h.style.getPropertyValue(responseHeightProperty),'',change);assert.equal(h.jobs.size,0,change);
  }
});

test('the temporary marker and CSS variable restore prior values without overwriting a later owner',()=>{
  const h=heightFixture(),guard=new ResponseHeightGuard(h.view);
  h.content.setAttribute(responseHeightAttribute,'previous');h.style.setProperty(responseHeightProperty,'12px','important');
  guard.begin(display);guard.clear();assert.equal(h.content.getAttribute(responseHeightAttribute),'previous');assert.equal(h.style.getPropertyValue(responseHeightProperty),'12px');assert.equal(h.style.getPropertyPriority(responseHeightProperty),'important');
  guard.begin(display);h.style.setProperty(responseHeightProperty,'24000px');guard.clear();assert.equal(h.style.getPropertyValue(responseHeightProperty),'24000px');
});

test('Reading and documents without a retained active response do not acquire a height guard',()=>{
  const h=heightFixture(),guard=new ResponseHeightGuard(h.view);h.mode('preview');guard.begin(display);assert.equal(h.guarded(),false);
  h.mode('source');guard.begin('Ordinary note text');assert.equal(h.guarded(),false);assert.equal(h.jobs.size,0);
});

test('the height rule survives native content style replacement without touching other editors',()=>{
  const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(css,/\.cm-content\[data-t3-response-height-guard="true"\]\s*\{\s*min-height:\s*var\(--send-to-t3-response-min-height\)\s*!important;/);
});
