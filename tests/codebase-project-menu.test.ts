import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
const bundle=build({entryPoints:['codebase-native.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external:['obsidian']});
const scope={environmentId:'env',projectId:'project',root:'/outside',title:'Project'};
async function fixture(){
 class Base{}class Element{children:Element[]=[];textContent='';createEl(_tag:string,options:any={}){const e=new Element();e.textContent=options.text??'';this.children.push(e);return e;}setText(text:string){this.textContent=text;}}
 class Modal{titleEl=new Element();contentEl=new Element();buttons:Button[]=[];input?:Text;closed=false;constructor(public app:any){}open(){}close(){this.closed=true;}}
 class Button{disabled=false;text='';cb?:()=>Promise<void>|void;setButtonText(t:string){this.text=t;return this;}setDisabled(v:boolean){this.disabled=v;return this;}setCta(){return this;}setWarning(){return this;}onClick(cb:any){this.cb=cb;return this;}click(){return this.disabled?undefined:this.cb?.();}}
 class Text{value='';cb?:(value:string)=>void;setValue(v:string){this.value=v;return this;}onChange(cb:any){this.cb=cb;return this;}change(v:string){this.value=v;this.cb?.(v);}}
 const buttons:Button[]=[],inputs:Text[]=[];
 class Setting{constructor(_el:Element){}setName(){return this;}addButton(cb:any){const b=new Button();buttons.push(b);cb(b);return this;}addText(cb:any){const t=new Text();inputs.push(t);cb(t);return this;}}
 let renames=0,deletes=0,updates=0,failLinks=false;const local=new Map<string,any>(),links=[{folderPath:'Linked',projectId:'project',environmentId:'env',workspaceRoot:'/outside',projectTitle:'Project'}];
 const io={renameProject:async()=>{renames++;},deleteProject:async()=>{deletes++;}};
 const storage={load:()=>undefined,save:async()=>{},projectChanged:async(_scope:any,change:any)=>{updates++;if(failLinks)throw Error('Link save failed');if(change.deleted)links.length=0;else links[0].projectTitle=change.title;}};
 const app:any={loadLocalStorage:(key:string)=>local.get(key),saveLocalStorage:(key:string,value:any)=>local.set(key,value),vault:{configDir:'.obsidian'},workspace:{iterateAllLeaves:()=>{}}};
 const module={exports:{} as any};runInNewContext((await bundle).outputFiles[0].text,{module,exports:module.exports,require:()=>({EditorSuggest:Base,ItemView:Base,FuzzySuggestModal:Base,Modal,Setting}),document:{createElement:()=>({})},TextEncoder,URL,crypto,setTimeout,clearTimeout,performance});
 const bridge=new module.exports.CodebaseBridge(app,{},io,()=>links,'menu',storage);
 return {bridge,app,io,storage,local,buttons,inputs,links,get renames(){return renames;},get deletes(){return deletes;},get updates(){return updates;},set failLinks(value:boolean){failLinks=value;}};
}
test('native rename cancel dispatches nothing and confirm sends once with a valid changed title',async()=>{
 const f=await fixture();const cancelled=f.bridge.projectModal(scope,false);f.buttons[0].click();assert.equal(cancelled.closed,true);assert.equal(f.renames,0);
 const modal=f.bridge.projectModal(scope,false),confirm=f.buttons[3];assert.equal(confirm.disabled,true);f.inputs[1].change('  ');assert.equal(confirm.disabled,true);f.inputs[1].change('Renamed');
 await Promise.all([confirm.click(),confirm.click()]);assert.equal(f.renames,1);assert.equal(f.updates,1);assert.equal(f.links[0].projectTitle,'Renamed');assert.equal(modal.closed,true);
});
test('delete confirmation names the project and threads; cancel keeps them; confirmed local retry does not repeat deletion',async()=>{
 const f=await fixture();const modal=f.bridge.projectModal(scope,true);assert.match(modal.contentEl.children.map((el:any)=>el.textContent).join(' '),/project and its threads from T3/);f.buttons[0].click();assert.equal(f.deletes,0);assert.equal(f.links.length,1);
 const deleting=f.bridge.projectModal(scope,true);f.failLinks=true;await f.buttons[3].click();assert.equal(f.deletes,1);assert.equal(deleting.closed,false);assert.equal(f.local.get('t3-codebase-browser:menu:project-changes').length,1);
 f.failLinks=false;await f.buttons[3].click();assert.equal(f.deletes,1);assert.equal(f.updates,2);assert.equal(f.links.length,0);assert.equal(deleting.closed,true);assert.equal(f.local.get('t3-codebase-browser:menu:project-changes').length,0);
});
test('reload reconciliation applies only a confirmed local link update and never redispatches the remote change',async()=>{
 const f=await fixture();f.local.set('t3-codebase-browser:menu:project-changes',[{scope,change:{title:'Confirmed rename'}}]);await f.bridge.reconcileProjectChanges();assert.equal(f.updates,1);assert.equal(f.renames,0);assert.equal(f.deletes,0);assert.equal(f.links[0].projectTitle,'Confirmed rename');
});

test('concurrent confirmed changes keep a later failed local update durable while the first drain waits',async()=>{
 const f=await fixture();let release!:()=>void,calls=0;
 f.storage.projectChanged=async()=>{calls++;if(calls===1)await new Promise<void>(r=>release=r);else throw Error('Second link update failed');};
 const first={id:'first',scope,change:{title:'First'}},second={id:'second',scope:{...scope,projectId:'other'},change:{deleted:true}};
 const key='t3-codebase-browser:menu:project-changes';f.local.set(key,[first]);const a=f.bridge.reconcileProjectChanges();await Promise.resolve();f.local.set(key,[first,second]);const b=f.bridge.reconcileProjectChanges();release();
 await assert.rejects(a,/Second link update failed/);await assert.rejects(b,/Second link update failed/);assert.equal(calls,2);assert.deepEqual(f.local.get(key),[second]);assert.equal(f.renames,0);assert.equal(f.deletes,0);
});
