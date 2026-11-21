import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {DomBatch,observeDocumentChanges,OBSERVED_ATTRIBUTES} from '../src/ui/dom-changes';

const page=(body:string)=>parseHTML(`<!doctype html><html><body>${body}</body></html>`).document as unknown as Document;

test('one document observer serves every listener and stops with the last one',()=>{
  const previous=globalThis.MutationObserver,created:any[]=[];
  class Observer {callback:(records:any[])=>void;options?:MutationObserverInit;target?:Node;disconnected=false;constructor(callback:(records:any[])=>void){this.callback=callback;created.push(this);}observe(target:Node,options:MutationObserverInit){this.target=target;this.options=options;}disconnect(){this.disconnected=true;}}
  globalThis.MutationObserver=Observer as any;
  try{
    const root=page('<p>Text</p>'),seen:string[]=[];
    const first=observeDocumentChanges(root,()=>seen.push('first')),second=observeDocumentChanges(root,()=>seen.push('second'));
    assert.equal(created.length,1,'listeners share one subtree observer');
    assert.equal(created[0].target,root.body);
    assert.deepEqual(created[0].options.attributeFilter,[...OBSERVED_ATTRIBUTES]);assert.equal(created[0].options.attributeOldValue,true);
    created[0].callback([{type:'childList',target:root.body,addedNodes:[],removedNodes:[]}]);
    assert.deepEqual(seen,['first','second'],'each batch reaches each listener once');
    first();assert.equal(created[0].disconnected,false);
    second();assert.equal(created[0].disconnected,true);
    observeDocumentChanges(root,()=>{})();assert.equal(created.length,2,'a later listener starts a new observer');
  }finally{globalThis.MutationObserver=previous;}
});

test('a batch narrows changes to added plugin subtrees and changed parents',()=>{
  const root=page(`<div class="cm-content">
    <div class="cm-line" id="line">Plain <span>text</span></div>
    <div class="cm-embed-block" id="block"><div class="callout" data-callout="t3-progress" id="fold"><div class="callout-title"><span class="send-to-t3-fold-key" data-t3-fold="a:complete"></span></div><div class="callout-content" id="content"><p id="para">Body</p></div></div></div>
  </div>`);
  const content=root.querySelector('.cm-content')!,line=root.getElementById('line')!,block=root.getElementById('block')!,para=root.getElementById('para')!;
  let queries=0;const query=line.querySelector.bind(line);line.querySelector=((selector:string)=>{queries++;return query(selector);}) as any;
  const batch=new DomBatch([
    {type:'childList',target:content,addedNodes:[line,block] as any,removedNodes:[] as any},
    {type:'childList',target:root.getElementById('content')!,addedNodes:[para] as any,removedNodes:[root.createElement('p')] as any},
  ] as any);
  assert.equal(batch.opaque,false);assert.equal(batch.removed,true);assert.equal(batch.elements,true);
  assert.deepEqual(batch.scopes().map(element=>element.id),['block'],'an ordinary editor line holds no plugin markup');
  assert.equal(queries,1);batch.scopes();assert.equal(queries,1,'scopes are computed once per batch');
  assert.deepEqual(batch.within('.callout[data-callout="t3-progress"]').map(element=>element.id),['fold']);
  assert.deepEqual(batch.containing('.callout').map(element=>element.id),['fold'],'a changed parent maps to its fold');
  assert.equal(new DomBatch([{type:'childList',target:content,addedNodes:[{nodeType:1}] as any,removedNodes:[] as any}] as any).opaque,true,'an uninspectable node asks for a full scan');
  assert.equal(new DomBatch([]).opaque,true);
});
