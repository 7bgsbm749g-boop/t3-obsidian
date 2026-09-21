import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decorateLinkedFolders,LINKED_FOLDER_BADGE_CLASS,WORKFLOW_FOLDER_ATTRIBUTE} from '../folder-indicator';
import {WORKFLOW_ACTIVITY_ATTRIBUTE} from '../workflow-activity';

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
  assert.equal(badge.getAttribute(WORKFLOW_FOLDER_ATTRIBUTE),'false');
  assert.equal(descendant.children.length,0);assert.equal(other.children.length,0);
  decorateLinkedFolders(root as any,[{...link,projectTitle:'Renamed project'}],['Projects/App']);
  assert.equal(name.textContent,'Renamed project');
  assert.equal(badge.children[0],logo);
  assert.equal(badge.getAttribute(WORKFLOW_FOLDER_ATTRIBUTE),'true');
  assert.equal(linked.children[0].title,'Linked to T3 Code project: Renamed project; folder workflows configured');
  decorateLinkedFolders(root as any,[link],[]);assert.equal(badge.getAttribute(WORKFLOW_FOLDER_ATTRIBUTE),'false','removing the last workflow removes the glow state');
  decorateLinkedFolders(root as any,[link],['Projects/App/Nested']);
  assert.equal(descendant.children.length,1,'a workflow folder inherits its parent link badge');assert.equal(descendant.children[0].getAttribute(WORKFLOW_FOLDER_ATTRIBUTE),'true');
  assert.equal(descendant.children[0].children[1].textContent,'','an inherited workflow badge must not show the parent project name');
  assert.equal(descendant.children[0].title,'T3 Code folder workflows configured');
  decorateLinkedFolders(root as any,[]);assert.equal(linked.children.length,0);
  assert.equal(descendant.children.length,0);
});

test('activity borders persist across a batch handoff and clear on completion without removing folder badges',()=>{
  const title=new FakeElement('Gym'),root={querySelectorAll:()=>[title]},link:any={folderPath:'/',projectTitle:'Inherited project'};
  decorateLinkedFolders(root as any,[link],['Gym'],new Map([['Gym','running']]));
  assert.equal(title.getAttribute(WORKFLOW_ACTIVITY_ATTRIBUTE),'running');assert.equal(title.children.length,2);
  const border=title.children.find(child=>child.className==='t3-workflow-progress-border');assert.ok(border);
  decorateLinkedFolders(root as any,[link],['Gym'],new Map([['Gym','queued']]));
  assert.equal(title.getAttribute(WORKFLOW_ACTIVITY_ATTRIBUTE),'queued');assert.ok(title.children.includes(border));assert.equal(title.children.length,2);
  decorateLinkedFolders(root as any,[link],['Gym']);
  assert.equal(title.getAttribute(WORKFLOW_ACTIVITY_ATTRIBUTE),null);assert.equal(title.children.length,1);
  assert.equal(title.children[0].className,LINKED_FOLDER_BADGE_CLASS);assert.equal(title.children[0].children[1].textContent,'');
});
