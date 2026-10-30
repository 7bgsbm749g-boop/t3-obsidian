import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileResponseDOM} from '../response-dom';

class Element {
  tagName='STRONG';attrs=new Map<string,string>();childNodes=[];children=[];firstChild=null;
  get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
  isEqualNode(){return false;}
  hasAttribute(name:string){return this.attrs.has(name);}
  getAttribute(name:string){return this.attrs.get(name)??null;}
  removeAttribute(name:string){this.attrs.delete(name);}
  setAttribute(name:string,value:string){this.attrs.set(name,value);}
  toggleAttribute(name:string,value:boolean){if(value)this.attrs.set(name,'');else this.attrs.delete(name);}
}
test('token reconciliation preserves client animation phase and removes obsolete rendered attributes',()=>{
  const current=new Element(),incoming=new Element();
  for(const [name,value] of [['data-t3-shine','true'],['data-t3-circle','true'],['style','--send-to-t3-shine-state: running;'],['title','old'],['data-old','old']])current.setAttribute(name,value);
  incoming.setAttribute('title','new');
  reconcileResponseDOM(current as any,incoming as any);
  assert.equal(current.getAttribute('data-t3-shine'),'true');assert.equal(current.getAttribute('data-t3-circle'),'true');
  assert.equal(current.getAttribute('style'),'--send-to-t3-shine-state: running;');assert.equal(current.getAttribute('title'),'new');assert.equal(current.hasAttribute('data-old'),false);
  current.setAttribute('style','color: red; --send-to-t3-shine-state: running;');
  reconcileResponseDOM(current as any,incoming as any);assert.equal(current.hasAttribute('style'),false,'Unrelated rendered styles still reconcile');
});

test('an unchanged compact reference keeps its already expanded canonical children',()=>{
  const current=new Element(),incoming=new Element();current.tagName=incoming.tagName='DETAILS';
  current.setAttribute('data-t3-tool-ref','same-content-hash');incoming.setAttribute('data-t3-tool-ref','same-content-hash');
  current.setAttribute('open','');current.setAttribute('data-loaded','retained');
  reconcileResponseDOM(current as any,incoming as any);
  assert.equal(current.hasAttribute('data-loaded'),true);assert.equal(current.hasAttribute('open'),true);
  incoming.setAttribute('data-t3-tool-ref','changed-hash');reconcileResponseDOM(current as any,incoming as any);
  assert.equal(current.getAttribute('data-t3-tool-ref'),'changed-hash');assert.equal(current.hasAttribute('data-loaded'),false);
});
