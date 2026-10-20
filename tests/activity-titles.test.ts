import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeResponseFolders,activityLeafPath,decorateActivityTabs,decorateMobileActivityTabs} from '../activity-titles';
import {decorateNoteIndicators} from '../folder-indicator';
import type {NoteIndicator} from '../explorer-responses';

class Element {
  className='';title='';textContent='';children:Element[]=[];attrs=new Map<string,string>();
  classList={contains:(name:string)=>this.className.split(' ').includes(name)};
  ownerDocument={createElement:()=>new Element()};
  parent?:Element;
  getAttribute(name:string){return this.attrs.get(name)??null;}
  hasAttribute(name:string){return this.attrs.has(name);}
  setAttribute(name:string,value:string){this.attrs.set(name,value);}
  removeAttribute(name:string){this.attrs.delete(name);}
  appendChild(child:Element){child.parent=this;this.children.push(child);}
  replaceChildren(...children:Element[]){this.children=[];children.forEach(child=>this.appendChild(child));}
  querySelector(selector:string){return this.children.find(child=>child.className===selector.slice(1))??null;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
}
const note=(active:number,input=0):NoteIndicator=>({active,input,complete:active||input?0:1,total:1});
const title=(path:string,folder=false)=>{
  const row=new Element();row.className=folder?'nav-folder-title':'nav-file-title';row.setAttribute('data-path',path);
  const label=new Element();label.className=row.className+'-content';row.appendChild(label);return {row,label};
};

test('active notes shine through ancestors without matching sibling folder prefixes or adding visible work badges',()=>{
  const file=title('App/Nested/Note.md'),parent=title('App',true),nested=title('App/Nested',true),sibling=title('Application',true);
  const root={querySelectorAll:()=>[file.row,parent.row,nested.row,sibling.row]};
  const notes=new Map([['App/Nested/Note.md',note(1,1)],['Application/Other.md',note(0)]]);
  assert.deepEqual([...activeResponseFolders(notes)],['App/Nested','App']);
  decorateNoteIndicators(root as any,notes);
  for(const item of [file,parent,nested])assert.equal(item.label.getAttribute('data-t3-active-title'),'true');
  assert.equal(sibling.label.hasAttribute('data-t3-active-title'),false);
  assert.equal(parent.row.children.length,1,'Ancestor activity uses only its original label');
  const badge=file.row.children[1];assert.equal(badge.children.length,0);assert.equal(badge.getAttribute('aria-label'),'1 active T3 response; 1 T3 response needs input');
  notes.set('App/Nested/Note.md',note(0));decorateNoteIndicators(root as any,notes);
  for(const item of [file,parent,nested])assert.equal(item.label.hasAttribute('data-t3-active-title'),false);
  assert.equal(file.row.children.length,1,'Completed responses keep no persistent badge beside the existing label');
});

test('tabs follow exact note paths across duplicate names, multiple panes, rename and completion',()=>{
  const first=new Element(),mirror=new Element(),other=new Element(),nonFile=new Element();
  const tabs=[{path:'App/Note.md',title:first},{path:'App/Note.md',title:mirror},{path:'Other/Note.md',title:other},{title:nonFile}];
  const notes=new Map([['App/Note.md',note(2)],['Other/Note.md',note(0,1)]]);
  decorateActivityTabs(tabs as any,notes);
  for(const label of [first,mirror])assert.equal(label.getAttribute('data-t3-active-title'),'true');
  for(const label of [other,nonFile])assert.equal(label.hasAttribute('data-t3-active-title'),false);
  notes.delete('App/Note.md');notes.set('App/Renamed.md',note(1));tabs[0].path='App/Renamed.md';
  decorateActivityTabs(tabs as any,notes);assert.equal(first.hasAttribute('data-t3-active-title'),true);assert.equal(mirror.hasAttribute('data-t3-active-title'),false);
  notes.clear();decorateActivityTabs(tabs as any,notes);assert.equal(first.hasAttribute('data-t3-active-title'),false);
});

test('restored deferred Markdown tabs use their saved path while loaded and renamed files take priority',()=>{
  const saved={type:'markdown',state:{file:'App/Note.md'}};
  assert.equal(activityLeafPath({view:{},getViewState:()=>saved}),'App/Note.md');
  assert.equal(activityLeafPath({view:{file:{path:'App/Renamed.md'}},getViewState:()=>saved}),'App/Renamed.md');
  for(const state of [{type:'canvas',state:{file:'App/Note.md'}},{type:'markdown',state:{file:42}},{type:'markdown',state:{file:''}},{type:'markdown'}])
    assert.equal(activityLeafPath({view:{},getViewState:()=>state}),undefined);
});

test('Mobile Tab Bar shines the exact current and adjacent notes, respects wrapping and clears terminal activity',()=>{
  const previous=new Element(),current=new Element(),next=new Element(),activeRow=new Element(),otherRow=new Element();
  for(const [row,path] of [[activeRow,'App/Note.md'],[otherRow,'Other/Note.md']] as const){
    const name=new Element();name.className='mtb-tab-name';name.textContent='Note';row.appendChild(name);
    const detail=new Element();detail.className='mtb-tab-detail';detail.textContent='1 · '+path;row.appendChild(detail);
  }
  const root={querySelectorAll:(selector:string)=>selector==='.mtb-tab-row'?[activeRow,otherRow]:selector==='.mtb-title-previous'?[previous]:selector==='.mtb-title-current'?[current]:[next]};
  const paths=['App/Note.md','Other/Note.md','App/Run.md'];
  const notes=new Map([['App/Note.md',note(1)],['App/Run.md',note(1)]]);
  const active=(label:Element)=>label.hasAttribute('data-t3-active-title');
  decorateMobileActivityTabs(root as any,paths,0,false,notes);
  assert.deepEqual([active(previous),active(current),active(next)],[false,true,false]);
  assert.equal(active(activeRow.children[0]),true);assert.equal(active(otherRow.children[0]),false,'Duplicate names use the row file path');
  decorateMobileActivityTabs(root as any,paths,2,true,notes);
  assert.deepEqual([active(previous),active(current),active(next)],[false,true,true]);
  decorateMobileActivityTabs(root as any,paths,2,false,notes);assert.equal(active(next),false);
  notes.clear();decorateMobileActivityTabs(root as any,paths,2,false,notes);
  for(const label of [previous,current,next,activeRow.children[0]])assert.equal(active(label),false);
});
