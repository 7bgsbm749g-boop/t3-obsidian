import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {applyThreadItem} from '../inline-thread';
import {findRunImport} from '../run-import-receipt';
import {responseAnchor} from '../native-response-projection';
import {localResponseRange} from '../local-response-binding';
import {updateResponseBindingData} from '../response-binding-data';
import {runImportResultMessage} from '../run-import';

const drain=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(){
  class Base{}
  const api={Plugin:Base,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base};
  const source={threadId:randomUUID(),projectId:randomUUID(),environmentId:'synthetic-machine'},messageId=randomUUID(),file={path:'Import.md'};
  let document='Synthetic note.\n';const registered:any[]=[],waits:string[]=[];
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(id:string)=>{assert.equal(id,'obsidian');return api;},crypto:webcrypto,URL,TextEncoder,TextDecoder,console,setTimeout,clearTimeout,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})}});
  const plugin=new module.exports.default();
  plugin.app={loadLocalStorage:()=>undefined,saveLocalStorage:()=>{},workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:(path:string)=>path===file.path?file:undefined,read:async()=>document,process:async(_file:any,change:(value:string)=>string)=>document=change(document)}};
  plugin.settings={vaultId:randomUUID(),inlineStreaming:{enabled:true},responseBindings:{}};
  let saveResult:any={saved:false,reason:'sync'};
  plugin.deviceInline={register:async(request:any)=>{assert.ok(localResponseRange(document,request.id,[request]));registered.push(request);plugin.settings.responseBindings=updateResponseBindingData(plugin.settings.responseBindings,request,'synthetic');},waitForSave:async(id:string)=>{waits.push(id);return typeof saveResult==='function'?saveResult(id):saveResult;}};
  plugin.connection=()=>({environmentId:source.environmentId});
  plugin.localResponseTarget=async()=>({environmentId:source.environmentId,workspaceRoot:'/synthetic',directory:'.obsidian/inline'});
  const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{messages:[{id:messageId,role:'user',text:'Synthetic prompt',createdAt:'2026-10-20T00:00:00Z',turnId:'synthetic-run',streaming:false},{id:'answer',role:'assistant',text:'Synthetic final',createdAt:'2026-10-20T00:01:00Z',turnId:'synthetic-run',streaming:false}],activities:[],latestTurn:{turnId:'synthetic-run',messageId,requestedAt:'2026-10-20T00:00:00Z',completedAt:'2026-10-20T00:01:00Z',state:'completed'},session:{status:'ready',activeTurnId:null}}}}).state;
  plugin.readImportHistory=async()=>({source,state,title:'Synthetic completed run'});
  return {plugin,source,messageId,registered,waits,read:()=>document,write:(text:string)=>{document=text;},move:(path:string)=>{file.path=path;},saveResult:(value:any)=>{saveResult=value;},import:()=>plugin.importRun(file.path,{id:source.projectId},source.threadId,messageId,false)};
}

test('a completed import cannot report success before its checked save finishes',async()=>{
  const h=await fixture();let release!:(value:any)=>void;const save=new Promise(resolve=>{release=resolve;});h.saveResult(()=>save);
  let returned=false;const pending=h.import().then((result:any)=>{returned=true;return result;});await drain();
  assert.equal(returned,false);assert.equal(h.waits.length,1);assert.equal(h.registered.length,1);assert.match(h.read(),/:::send-to-t3-response/);
  const id=h.registered[0].id;h.write(h.read().replace(responseAnchor(id),'Synthetic final'));release({saved:true});
  const result=await pending;assert.equal(result.saveState,'saved');assert.equal(runImportResultMessage(result),'Response imported and saved.');assert.doesNotMatch(h.read(),/:::send-to-t3-response/);
});
test('a Sync wait reports a pending import, and reimport resumes its settings binding without another block',async()=>{
  const h=await fixture(),first=await h.import(),original=h.read();
  assert.equal(first.saveState,'pending');assert.equal(first.pendingReason,'sync');assert.match(runImportResultMessage(first),/not saved yet.*Sync/);
  const second=await h.import();assert.equal(second.duplicate,true);assert.equal(second.saveState,'pending');assert.equal(h.registered.length,2);assert.equal(h.waits.length,2);
  assert.equal(h.registered[0].id,h.registered[1].id);assert.equal(h.read(),original);assert.equal(h.read().match(/:::send-to-t3-response /g)?.length,1);
});
test('a missing settings record can be recovered with the existing receipt identity after a note move',async()=>{
  const h=await fixture();await h.import();const original=h.read(),receipt=findRunImport(original,h.source,h.messageId)!;
  h.plugin.settings.responseBindings={};h.move('Moved.md');await h.import();
  assert.equal(h.registered.length,2);assert.equal(h.registered[1].id,receipt.bindingId);assert.equal(h.registered[1].notePath,'Moved.md');assert.equal(h.read(),original);
});
test('reimport preserves an already saved response and its user edits without registering or saving again',async()=>{
  const h=await fixture();await h.import();const id=h.registered[0].id;
  h.write(h.read().replace(responseAnchor(id),'Synthetic final with a user edit.'));const original=h.read(),result=await h.import();
  assert.equal(result.duplicate,true);assert.equal(result.saveState,'saved');assert.equal(h.registered.length,1);assert.equal(h.waits.length,1);assert.equal(h.read(),original);
});
