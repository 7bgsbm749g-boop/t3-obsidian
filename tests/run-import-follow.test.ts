import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {displayCommand,type ThreadDisplay} from '../thread-display';
import type {InlineThreadState} from '../inline-thread';

const source={threadId:'thread',projectId:'project',environmentId:'machine'},notePath='Import.md';
const state:InlineThreadState={historyComplete:true,activities:[],messages:['earlier','selected','later','running'].map(id=>({id,role:'user',text:id,turnId:id,streaming:false}))};
async function fixture(displays:ThreadDisplay[]=[]){
  class Base{}
  const api={Plugin:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile:true}};
  const module={exports:{} as any},commands:any[]=[];
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(id:string)=>{assert.equal(id,'obsidian');return api;},crypto:webcrypto,URL,TextEncoder,TextDecoder,console,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})}});
  const plugin=new module.exports.default();
  plugin.executeAgentCommand=async(command:any)=>{commands.push(command);return displayCommand(displays,command,{readThread:async()=>state,validateDestination:async()=>{},responseBindings:async()=>[],prepareDisplay:async()=>{throw Error('unexpected');},attachDisplay:async()=>{},save:async()=>{}},0);};
  return {commands,displays,follow:(messageId='selected')=>plugin.followImportedThread(source,notePath,messageId,state)};
}
function display(boundary:string[],extra:Partial<ThreadDisplay>={}):ThreadDisplay{return {...source,id:randomUUID(),scope:'thread',enabled:true,createdAt:'2026-10-20T00:00:00Z',boundary,destinations:[{id:randomUUID(),path:notePath}],bindings:[],...extra};}

test('follow imports anchor at the selected prompt and reuse coverage on repeated and later imports',async()=>{
  const h=await fixture();await h.follow();
  assert.deepEqual(h.commands.map(c=>c.kind),['thread-streams','stream-thread']);assert.equal(h.commands[1].afterMessageId,'selected');
  assert.deepEqual(h.displays[0].boundary,['earlier','selected']);
  await h.follow();await h.follow('later');assert.equal(h.displays.length,1);assert.equal(h.commands.length,4);
});
for(const paused of [false,true])for(const shared of [false,true])test(`reimport replaces a ${paused?'paused':'enabled'} late boundary for ${shared?'only this destination':'this note'}`,async()=>{
  const old=display(['earlier','selected','later','running'],{enabled:!paused});
  if(shared)old.destinations.push({id:randomUUID(),path:'Other.md'});
  const binding={messageId:'running',turnId:'running',destinationId:old.destinations[0].id,status:'attached' as const};old.bindings.push(binding);
  const h=await fixture([old]);await h.follow();
  assert.deepEqual(h.commands.map(c=>c.kind),['thread-streams','stream-thread',shared?'remove-stream-destination':'cancel-thread-stream']);
  assert.deepEqual(h.displays[1].boundary,['earlier','selected']);assert.equal(h.displays[1].enabled,true);assert.equal(old.bindings[0],binding);
  if(shared){assert.equal(old.cancelled,undefined);assert.equal(old.destinations[0].removed,true);assert.equal(old.destinations[1].removed,undefined);assert.equal(old.enabled,!paused);}else assert.equal(old.cancelled,true);
  await h.follow();assert.equal(h.displays.length,2);
});
test('reimporting an earlier run extends coverage while removed and cancelled registrations cannot replay the old command',async()=>{
  for(const previous of [display(['earlier','selected','later']),display(['earlier','selected'],{cancelled:true,enabled:false}),display(['earlier','selected'],{destinations:[{id:randomUUID(),path:notePath,removed:true}]})]){
    const h=await fixture([previous]);await h.follow();
    assert.equal(h.displays.length,2);assert.notEqual(h.displays[1].id,previous.id);assert.deepEqual(h.displays[1].boundary,['earlier','selected']);
  }
});
