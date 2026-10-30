import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {commandId} from '../direct';
import {validateAgentCommand,isEventCommand} from '../note-command';

const source={threadId:'thread',projectId:'project',environmentId:'machine'};
const command=()=>({version:1,id:randomUUID(),kind:'reserve-thread-response',source,messageId:randomUUID(),responses:[{path:'Note.md',bindingId:randomUUID()}]});
test('stream reservation validation rejects ambiguous destinations and invalid identities at the command boundary',()=>{
  const valid=command();assert.equal(isEventCommand(valid),true);assert.equal(validateAgentCommand(valid),valid);
  for(const change of [{id:'bad'},{messageId:'bad\nmessage'},{source:{...source,environmentId:''}},{responses:[]},{responses:[{path:'../Note.md',bindingId:randomUUID()}]},{responses:[{path:'Note.md',bindingId:'bad'}]},{responses:[...valid.responses,...valid.responses]}, {responses:Array.from({length:33},(_,i)=>({path:i+'.md',bindingId:randomUUID()}))}])assert.throws(()=>validateAgentCommand({...valid,...change}));
});

async function fixture(){
  class Base{}
  const module={exports:{} as any},api={Plugin:Base,PluginSettingTab:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,Notice:Base,Platform:{isMobile:true}};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(id:string)=>{assert.equal(id,'obsidian');return api;},crypto:webcrypto,URL,TextEncoder,TextDecoder,console,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})}});
  const plugin=new module.exports.default(),commands:any[]=[],failures:any[]=[];
  plugin.settings={};plugin.vaultConnection=()=>({workspaceRoot:'/synthetic-vault'});plugin.localInlineEnvironment=async()=>source.environmentId;
  plugin.executeAgentCommand=async(input:any)=>{commands.push(JSON.parse(JSON.stringify(input)));return {id:input.id,ok:true};};
  plugin.assertRequestMode=async()=>{};plugin.captureNoteContext=async()=>{};plugin.responseGuard=async()=>{};plugin.failRequest=async(_request:any,error:Error,stage:string)=>{failures.push({error:error.message,stage});};
  plugin.deviceInline={register:async()=>{}};
  const id=randomUUID(),binding={id:randomUUID(),version:4,notePath:'Note.md'};
  const request={id,project:{id:source.projectId},connection:{transport:'direct',environmentId:source.environmentId},threadId:source.threadId,inlineBindings:[binding],inlineHost:binding};
  return {plugin,commands,request,binding,failures};
}
test('sends, new threads, steering and continuations reserve their exact streams with stable retry identities',async()=>{
  const h=await fixture();await h.plugin.reserveResponseStreams(h.request);await h.plugin.reserveResponseStreams(h.request);
  assert.deepEqual(h.commands[0],h.commands[1]);assert.equal(h.commands[0].id,commandId(h.request.id,'reserve-thread-response'));assert.equal(h.commands[0].messageId,commandId(h.request.id,'message'));assert.deepEqual(h.commands[0].responses,[{path:'Note.md',bindingId:h.binding.id}]);
  await h.plugin.reserveResponseStreams({...h.request,threadId:undefined});assert.equal(h.commands.at(-1).source.threadId,commandId(h.request.id,'thread'));
  for(const continuation of [{inlineSteering:{jobId:h.binding.id,input:{messageId:commandId(h.request.id,'message')},targets:[{jobId:h.binding.id,notePath:'Note.md'}]}},{inlineFollow:{jobId:h.binding.id,notePath:'Note.md'}}]){
    await h.plugin.reserveResponseStreams({...h.request,inlineBindings:undefined,inlineHost:undefined,...continuation});assert.deepEqual(h.commands.at(-1).responses,[{path:'Note.md',bindingId:h.binding.id}]);
  }
  const count=h.commands.length;
  await h.plugin.reserveResponseStreams({...h.request,inlineBindings:[],inlineHost:undefined});assert.equal(h.commands.length,count);
  h.plugin.vaultConnection=()=>undefined;await h.plugin.reserveResponseStreams(h.request);assert.equal(h.commands.length,count);
});
test('dispatch waits for the watcher acknowledgement and refuses to send when it is rejected',async()=>{
  const h=await fixture();let resolve!:(value:any)=>void;
  h.plugin.executeAgentCommand=()=>new Promise(done=>{resolve=done;});
  const dispatch=h.plugin.dispatch(h.request,true);let finished=false;dispatch.then(()=>{finished=true;},()=>{finished=true;});
  for(let i=0;i<10;i++)await new Promise(done=>setImmediate(done));
  assert.equal(typeof resolve,'function');assert.equal(finished,false);assert.equal(h.failures.length,0);
  resolve({ok:false,error:'watcher storage unavailable'});await assert.rejects(dispatch,/watcher storage unavailable/);
  assert.deepEqual(h.failures,[{error:'watcher storage unavailable',stage:'stream-reservation'}]);
});
