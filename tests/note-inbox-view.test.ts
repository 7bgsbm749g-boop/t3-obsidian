import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
const compiled=build({entryPoints:['src/notes/note-inbox-view.ts'],bundle:true,platform:'browser',format:'cjs',write:false});
test('native inbox lab uses the installed product and native vault APIs',async()=>{
 const result=await build({entryPoints:['tests/native/note-inbox-lab.ts'],bundle:true,platform:'browser',format:'cjs',write:false,external:['node:*'],define:{INBOX_LAB_REPORT:'"synthetic-report.json"',INBOX_LAB_VAULT:'"Synthetic test vault"'}});
 assert.match(result.outputFiles[0].text,/noteInboxView/);assert.match(result.outputFiles[0].text,/Finish inbox validation/);
});
async function fixture(){
 const {document,window}=parseHTML('<html><body><div data-type="file-explorer" class="workspace-leaf-content"><div class="nav-header"><div class="nav-buttons-container"><button>Native button</button></div></div><div class="nav-files-container">Original tree</div></div></body></html>');
 const proto=window.HTMLElement.prototype as any;
 proto.createEl=function(tag:string,options:any={}){const el=document.createElement(tag);el.textContent=options.text??'';el.className=options.cls??'';for(const [key,value] of Object.entries(options.attr??{}))el.setAttribute(key,String(value));this.appendChild(el);return el;};
 proto.createDiv=function(options:any){return this.createEl('div',options);};proto.createSpan=function(options:any){return this.createEl('span',options);};proto.empty=function(){this.replaceChildren();};
 class TFile {constructor(public path:string){}}
 let leaves:any[]=[{view:{containerEl:document.querySelector('[data-type=file-explorer]')}}],active:string|undefined;
 const opened:any[]=[],changes:any[]=[],menus:any[]=[],notices:string[]=[];
 const app:any={workspace:{getLeavesOfType:()=>leaves,getActiveFile:()=>active?{path:active}:null,getLeaf:(tab:any)=>({openFile:async(file:any)=>opened.push({path:file.path,tab})})},vault:{getAbstractFileByPath:(path:string)=>new TFile(path)}};
 class Menu {items:any[]=[];addItem(fn:any){const item:any={};for(const name of ['setTitle','setIcon','setDisabled','onClick'])item[name]=(value:any)=>{item[name==='onClick'?'click':name.slice(3).toLowerCase()]=value;return item;};fn(item);this.items.push(item);return this;}addSeparator(){}showAtMouseEvent(){menus.push(this);}}
 const module={exports:{} as any};runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:()=>({TFile,Menu,setIcon:()=>{},Notice:class {constructor(text:string){notices.push(text);}}}),console,setTimeout,clearTimeout,Date,document,window});
 const make=(path:string,section='regular',extra:any={})=>({path,ids:[path],title:path.split('/').at(-1)!.slice(0,-3),folder:path.includes('/')?path.split('/').slice(0,-1).join('/'):'',activity:'a',updatedAt:1,section,pinned:section==='pinned',indicator:{active:0,input:0,total:1,complete:0},...extra});
 let notes:any[]=[make('Docs/Pinned.md','pinned'),make('Docs/Working.md','working',{indicator:{active:1,input:0,total:1,complete:0}}),make('Docs/Regular.md'),make('Docs/Snoozed.md','snoozed',{until:Date.now()+60_000}),make('Docs/Settled.md','settled')];
 let state=module.exports.loadInboxViewState(undefined);
 const controller=new module.exports.NoteInboxView(app,{notes:()=>notes,change:async(note:any,action:any)=>{changes.push({note,action});},state:()=>state,saveState:(next:any)=>{state=next;}});controller.refresh();
 return {controller,app,document,window,opened,changes,menus,notices,exports:module.exports,state:()=>state,setNotes:(value:any[])=>{notes=value;},setActive:(path:string)=>{active=path;},setLeaves:(value:any[])=>{leaves=value;}};
}
test('T3 toolbar mode toggles the native explorer, persists choices, and restores original tree on disposal',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());const root=f.document.querySelector('[data-type=file-explorer]')!,button=f.document.querySelector<HTMLButtonElement>('.t3-note-inbox-toggle')!;
 assert.equal(button.getAttribute('aria-pressed'),'false');button.click();assert.equal(f.state().enabled,true);assert.equal(root.classList.contains('t3-note-inbox-mode'),true);
 assert.deepEqual(Array.from(f.document.querySelectorAll('[data-inbox-section]')).map(el=>el.getAttribute('data-inbox-section')),['pinned','working','regular','snoozed','settled']);
 assert.equal(f.document.querySelectorAll('.t3-note-inbox-row').length,3,'snoozed and settled start collapsed');
 assert.equal(f.document.querySelector('.nav-files-container')!.textContent,'Original tree');
 f.controller.refresh();assert.equal(f.document.querySelectorAll('.t3-note-inbox-toggle').length,1);
 button.click();assert.equal(root.classList.contains('t3-note-inbox-mode'),false);f.controller.dispose();assert.equal(f.document.querySelector('.t3-note-inbox'),null);assert.equal(f.document.querySelector('.nav-buttons-container')!.textContent,'Native button');
});
test('search reveals matching collapsed notes; opening uses full paths and new tabs; settle and menus use note identity',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());f.document.querySelector<HTMLButtonElement>('.t3-note-inbox-toggle')!.click();
 const input=f.document.querySelector<HTMLInputElement>('input')!;input.value='Settled';input.dispatchEvent(new f.window.Event('input'));
 assert.equal(f.document.querySelectorAll('.t3-note-inbox-row').length,1);f.document.querySelector<HTMLButtonElement>('.t3-note-inbox-open')!.click();await Promise.resolve();assert.equal(f.opened[0].path,'Docs/Settled.md');
 f.document.querySelector<HTMLButtonElement>('[aria-label="Reopen note"]')!.click();await Promise.resolve();assert.equal(f.changes[0].action.kind,'regular');
 f.document.querySelector<HTMLButtonElement>('[aria-label="Note actions"]')!.click();f.menus[0].items[0].click();await Promise.resolve();assert.equal(f.opened[1].tab,'tab');
 f.controller.dispose();
});
test('live refresh retains search and rows, active file highlights correctly, removed explorers clean up',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());f.document.querySelector<HTMLButtonElement>('.t3-note-inbox-toggle')!.click();const input=f.document.querySelector('input'),row=f.document.querySelector('.t3-note-inbox-row');
 f.controller.refresh();assert.equal(f.document.querySelector('input'),input);assert.equal(f.document.querySelector('.t3-note-inbox-row'),row);
 f.setActive('Docs/Regular.md');f.controller.refresh();assert.equal(f.document.querySelector('.t3-note-inbox-row.is-active')!.getAttribute('data-note-path'),'Docs/Regular.md');
 f.setLeaves([]);f.controller.refresh();assert.equal(f.document.querySelector('.t3-note-inbox-toggle'),null);assert.equal(f.document.querySelector('.t3-note-inbox'),null);f.controller.dispose();
});
test('empty inbox does not expose unstreamed vault files',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());f.setNotes([]);f.document.querySelector<HTMLButtonElement>('.t3-note-inbox-toggle')!.click();assert.match(f.document.querySelector('.t3-note-inbox-empty')!.textContent!,/No notes with T3 streams/);assert.equal(f.document.querySelectorAll('.t3-note-inbox-row').length,0);f.controller.dispose();
});
