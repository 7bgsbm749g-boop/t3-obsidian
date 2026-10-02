import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decorateLinkedFolders} from '../folder-indicator';

class FakeElement{
  className='';textContent='';title='';parent?:FakeElement;children:FakeElement[]=[];attrs=new Map<string,string>();
  ownerDocument={createElement:()=>new FakeElement(),createElementNS:()=>new FakeElement()};
  constructor(path?:string){if(path)this.attrs.set('data-path',path);}
  getAttribute(name:string){return this.attrs.get(name)??null;}
  hasAttribute(name:string){return this.attrs.has(name);}
  removeAttribute(name:string){this.attrs.delete(name);}
  setAttribute(name:string,value:string){this.attrs.set(name,value);if(name==='class')this.className=value;}
  appendChild(child:FakeElement){child.parent=this;this.children.push(child);return child;}
  replaceChildren(...children:FakeElement[]){this.children=[];this.textContent='';for(const child of children)this.appendChild(child);}
  querySelector<T>(selector:string):T|null{return (this.children.find(child=>child.className===selector.slice(1))??null) as T|null;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
}

test('file explorer badges mark exact linked folders, update labels, and never duplicate',()=>{
  const linked=new FakeElement('Projects/App'),descendant=new FakeElement('Projects/App/Nested'),other=new FakeElement('Other');
  const root={querySelectorAll:()=>[linked,descendant,other]};
  const link:any={id:'link',folderPath:'Projects/App',projectId:'p',projectTitle:'App project',workspaceRoot:'/app',connectionId:'c',self:false};
  decorateLinkedFolders(root as any,[link]);decorateLinkedFolders(root as any,[link]);
  assert.equal(linked.children.length,1);
  const badge=linked.children[0],logo=badge.children[0],name=badge.children[1];
  assert.equal(logo.getAttribute('aria-hidden'),'true');
  assert.equal(name.textContent,'App project');
  assert.equal(linked.children[0].title,'Linked to T3 Code project: App project');
  assert.equal(descendant.children.length,0);assert.equal(other.children.length,0);
  decorateLinkedFolders(root as any,[{...link,projectTitle:'Renamed project'}]);
  assert.equal(name.textContent,'Renamed project');
  assert.equal(badge.children[0],logo);
  assert.equal(linked.children[0].title,'Linked to T3 Code project: Renamed project');
  decorateLinkedFolders(root as any,[]);assert.equal(linked.children.length,0);
  assert.equal(descendant.children.length,0);
});

test('badge observers bind only explorer containers and rebind after layout changes',async()=>{
  const {installFolderIndicators}=await import('../folder-indicator');
  const previous=globalThis.MutationObserver,instances:any[]=[];
  class Observer{
    target:any;disconnected=false;
    constructor(public callback:()=>void){instances.push(this);}
    observe(target:any){this.target=target;}
    disconnect(){this.disconnected=true;}
  }
  globalThis.MutationObserver=Observer as any;
  let queries=0;
  const explorer={querySelectorAll:()=>{queries++;return [];}};
  let containers=[explorer];
  const body={querySelectorAll:(selector:string)=>selector==='.nav-files-container'?containers:[]};
  try{
    const controller=installFolderIndicators(body as any,()=>[]);
    assert.equal(instances.length,1);assert.equal(instances[0].target,explorer);
    assert.notEqual(instances[0].target,body,'Editor mutations are outside the observed subtree');
    const before=queries;instances[0].callback();instances[0].callback();await Promise.resolve();
    assert.equal(queries,before+1,'Explorer mutations coalesce');
    const replacement={querySelectorAll:()=>[]};containers=[replacement];controller.refresh();
    assert.equal(instances[0].disconnected,true);assert.equal(instances[1].target,replacement);
    controller.dispose();assert.equal(instances[1].disconnected,true);
    const count=queries;instances[0].callback();await Promise.resolve();assert.equal(queries,count);
  }finally{globalThis.MutationObserver=previous;}
});
