import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {installStreamBlockControls} from '../src/responses/stream-block-controls';

const widget=(id:string,collapsed=true)=>`<div class="cm-embed-block" id="${id}"><div class="callout${collapsed?' is-collapsed':''}" data-callout="t3-progress"><div class="callout-title"><span class="send-to-t3-fold-key" data-t3-fold="${id}:complete"></span>Done</div><div class="callout-content"><p>Output</p></div></div><div class="embed-actions"><div class="edit-block-button"></div></div></div>`;

function setup(body:string){
  const {document}=parseHTML(`<!doctype html><html><body><div class="markdown-source-view is-live-preview"><div class="cm-content">${body}</div></div></body></html>`);
  const root=document as unknown as Document&{win:any};
  root.win={createDiv:()=>root.createElement('div'),createSpan:()=>root.createElement('span'),createEl:(tag:string)=>root.createElement(tag)};
  const previous=globalThis.MutationObserver;let deliver:(records:any[])=>void=()=>{};
  globalThis.MutationObserver=class {constructor(callback:(records:any[])=>void){deliver=callback;}observe(){}disconnect(){}} as any;
  let scans=0;const scan=root.querySelectorAll.bind(root);
  root.querySelectorAll=((selector:string)=>{if(selector.includes('t3-progress'))scans++;return scan(selector);}) as any;
  const app:any={workspace:{getLeavesOfType:()=>[]}};
  const dispose=installStreamBlockControls(app,root,()=>{},error=>{throw error;});
  const content=root.querySelector('.cm-content')!;
  const flush=async()=>{await Promise.resolve();await Promise.resolve();};
  return {root,content,deliver:(records:any[])=>deliver(records),flush,scans:()=>scans,close:(id:string)=>root.getElementById(id)?.querySelector('.send-to-t3-stream-close'),
    dispose:()=>{dispose();globalThis.MutationObserver=previous;}};
}

test('stream controls process only the widgets that a change mounts, changes or removes',async()=>{
  const h=setup(widget('first')+'<div class="cm-line">Text</div>');
  try{
    assert.ok(h.close('first'),'the initial pass covers the document');
    const initial=h.scans();
    // Scrolling mounts another completed stream and ordinary lines.
    const holder=h.root.createElement('div');holder.innerHTML=widget('second');const second=holder.firstElementChild!;
    const line=h.root.createElement('div');line.className='cm-line';line.textContent='More';
    h.content.append(second,line);
    h.deliver([{type:'childList',target:h.content,addedNodes:[second,line],removedNodes:[]}]);await h.flush();
    assert.ok(h.close('second'),'the mounted stream receives its controls');
    assert.equal(h.scans(),initial,'mounting does not rescan every stream in the document');
    // A collapse change reaches only its fold.
    const fold=second.querySelector<HTMLElement>('.callout')!;fold.classList.remove('is-collapsed');
    h.deliver([{type:'attributes',target:fold,attributeName:'class',oldValue:'callout is-collapsed'}]);await h.flush();
    assert.equal(second.classList.contains('send-to-t3-stream-collapsed'),false);
    assert.equal(h.scans(),initial);
    // Unmounting releases the stream's controls without a document scan.
    const first=h.root.getElementById('first')!;const actions=first.querySelector('.embed-actions')!;
    first.remove();h.deliver([{type:'childList',target:h.content,addedNodes:[],removedNodes:[first]}]);await h.flush();
    assert.equal(actions.classList.contains('send-to-t3-stream-actions'),false);assert.equal(actions.querySelector('.send-to-t3-stream-close'),null);
    // A re-rendered callout that is no longer a generated stream gives up the toolbar.
    const secondActions=second.querySelector('.embed-actions')!;
    const plain=h.root.createElement('div');plain.className='callout';plain.setAttribute('data-callout','t3-progress');plain.innerHTML='<div class="callout-title">User text</div>';
    fold.replaceWith(plain);h.deliver([{type:'childList',target:second,addedNodes:[plain],removedNodes:[fold]}]);await h.flush();
    assert.equal(secondActions.querySelector('.send-to-t3-stream-close'),null);
    assert.equal(h.scans(),initial,'none of these changes rescans the document');
  }finally{h.dispose();}
});

test('stream fold keys are read from a cached title element and follow its attribute',async()=>{
  const h=setup(widget('first'));
  try{
    const fold=h.root.querySelector<HTMLElement>('.callout')!;let lookups=0;const lookup=fold.querySelector.bind(fold);
    fold.querySelector=((selector:string)=>{if(selector.includes('fold-key'))lookups++;return lookup(selector);}) as any;
    for(let i=0;i<3;i++){h.deliver([{type:'childList',target:fold.querySelector('.callout-content'),addedNodes:[],removedNodes:[]}]);await h.flush();}
    assert.equal(lookups,0,'repeated passes reuse the key element');
    const title=fold.querySelector('.callout-title')!,replacement=h.root.createElement('div');replacement.className='callout-title';replacement.innerHTML='Plain';
    title.replaceWith(replacement);h.deliver([{type:'childList',target:fold,addedNodes:[replacement],removedNodes:[title]}]);await h.flush();
    assert.equal(lookups>0,true,'a replaced title is looked up again');
    assert.equal(h.close('first'),null,'a fold without a key loses its controls');
  }finally{h.dispose();}
});
