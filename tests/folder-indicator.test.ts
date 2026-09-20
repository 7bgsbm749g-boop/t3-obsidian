import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decorateLinkedFolders,LINKED_FOLDER_BADGE_CLASS} from '../folder-indicator';

class FakeElement{
  className='';textContent='';title='';parent?:FakeElement;children:FakeElement[]=[];attrs=new Map<string,string>();
  ownerDocument={createElement:()=>new FakeElement(),createElementNS:()=>new FakeElement()};
  constructor(path?:string){if(path)this.attrs.set('data-path',path);}
  getAttribute(name:string){return this.attrs.get(name)??null;}
  setAttribute(name:string,value:string){this.attrs.set(name,value);}
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
});
