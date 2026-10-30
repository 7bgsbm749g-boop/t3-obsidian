import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {assertThreadNoteMode,oneToOneNoteThreads,threadNoteMode} from '../thread-note-mode';
import {mutateNoteThreads,type NoteThread} from '../note-threads';
import {displayCommand,tickDisplay,type DisplayHost,type ThreadDisplay} from '../thread-display';

const pair=(notePath='A.md',threadId='one',selectedAt='2026-10-30T12:00:00.000Z'):NoteThread=>({notePath,threadId,selectedAt,projectId:'project',environmentId:'machine',connectionId:'connection',workspaceRoot:'/project'});
const target={threadId:'one',projectId:'project',environmentId:'machine'};

test('migration defaults to Free and mode projections preserve the complete graph',()=>{
  assert.equal(threadNoteMode(undefined),'free');assert.equal(threadNoteMode('invalid'),'free');assert.equal(threadNoteMode('one-to-one'),'one-to-one');
  const entries=[pair(),pair('A.md','two','2026-10-30T13:00:00.000Z'),pair('B.md','two','2026-10-30T14:00:00.000Z')],before=JSON.stringify(entries);
  assert.deepEqual(oneToOneNoteThreads(entries).map(entry=>[entry.notePath,entry.threadId]),[['B.md','two'],['A.md','one']]);
  assert.deepEqual(oneToOneNoteThreads([...entries].reverse()),oneToOneNoteThreads(entries));assert.equal(JSON.stringify(entries),before);
  assert.doesNotThrow(()=>assertThreadNoteMode('free',entries,'A.md',target,['A.md','B.md']));
});

test('1:1 refuses thread changes, thread reuse, and source/destination splits; Free restores them',()=>{
  const entries=[pair()];
  assert.doesNotThrow(()=>assertThreadNoteMode('one-to-one',entries,'A.md',target,['A.md']));
  for(const mode of ['one-to-one','free'] as const)for(const [path,threadId,destinations] of [
    ['A.md',undefined,[]],['A.md','two',[]],['B.md','one',['B.md']],['A.md','one',['B.md']],['A.md','one',['A.md','B.md']],
  ] as Array<[string,string|undefined,string[]]>){
    const action=()=>assertThreadNoteMode(mode,entries,path,{...target,threadId},destinations);
    if(mode==='free')assert.doesNotThrow(action);else assert.throws(action,/1:1 mode/);
  }
  assert.doesNotThrow(()=>assertThreadNoteMode('one-to-one',entries,'B.md',{...target,threadId:'two'},['B.md']));
  assert.doesNotThrow(()=>assertThreadNoteMode('one-to-one',entries,'B.md',{...target,threadId:undefined}));
  assert.doesNotThrow(()=>assertThreadNoteMode('one-to-one',entries,undefined,target));
});

test('pairs stay stable across equal timestamps, independent environments, moves, deletion, and stale replicas',()=>{
  const entries=[pair('B.md'),pair('A.md'),{...pair('C.md'),environmentId:'other-machine'}];
  assert.deepEqual(oneToOneNoteThreads(entries).map(entry=>entry.notePath),['A.md','C.md']);
  assert.deepEqual(oneToOneNoteThreads(entries.reverse()).map(entry=>entry.notePath),['A.md','C.md']);
  const moved=mutateNoteThreads([pair()],'A.md','Moved.md');
  assert.deepEqual(oneToOneNoteThreads([...moved,pair()]).map(entry=>entry.notePath),['Moved.md']);
  assert.deepEqual(oneToOneNoteThreads([...mutateNoteThreads(moved,'Moved.md'),...moved]),[]);
});

async function pluginFixture(){
  class Base{}
  const module={exports:{} as any},api={Plugin:Base,PluginSettingTab:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,Notice:Base,Platform:{isMobile:true}};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},crypto:webcrypto,URL,TextEncoder,TextDecoder,console,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})}});
  const p=new module.exports.default();p.settings={threadNoteMode:'one-to-one',noteThreads:[pair()],paired:[{id:'connection',environmentId:'machine'}],completion:{action:'keep'},inlineStreaming:{enabled:true}};
  const project={id:'project',workspaceRoot:'/project',connectionId:'connection'};
  p.connection=()=>({connectionId:'connection',environmentId:'machine'});p.projectForNoteThread=()=>project;
  p.chatTarget=async()=>({project,link:{}});p.projectReadinessError=()=>undefined;p.recordSendFailure=()=>{};
  return {p,project};
}

test('real Send, Ask, import, attachment and dispatch boundaries reject conflicts before note or network work',async()=>{
  const {p,project}=await pluginFixture();let mutations=0;
  const forbidden=async()=>{mutations++;throw Error('unexpected side effect');};
  p.app={};p.editorForNoteSend=forbidden;p.readImportHistory=forbidden;p.deviceInline={};p.captureNoteContext=forbidden;
  await assert.rejects(p.send({path:'A.md'},project,{newThread:true,throwOnError:true}),/1:1 mode/);
  await assert.rejects(p.sendChat('Question',{path:'A.md'},{newThread:true}),/1:1 mode/);
  await assert.rejects(p.importRun('B.md',project,'one','message'),/1:1 mode/);
  await assert.rejects(p.prepareStreamBindings({project,connection:p.connection(),threadId:'one'},['B.md'],undefined,undefined,'A.md'),/1:1 mode/);
  await assert.rejects(p.dispatch({project,connection:p.connection(),threadId:'one',noteThread:{notePath:'B.md'}}),/1:1 mode/);
  assert.equal(mutations,0);
  assert.equal(p.noteThread('A.md').threadId,'one');
  assert.deepEqual(Array.from(await p.availableModeThreads('B.md',project,[{id:'one'},{id:'two'}]),(thread:any)=>thread.id),['two']);
  p.settings.threadNoteMode='free';assert.deepEqual(Array.from(await p.availableModeThreads('B.md',project,[{id:'one'},{id:'two'}]),(thread:any)=>thread.id),['one','two']);
});

test('legacy background streams wait in 1:1 and resume without destroying their history in Free',async()=>{
  const entries=[pair()],display:ThreadDisplay={...target,id:'10000000-0000-4000-8000-000000000000',scope:'thread',enabled:true,createdAt:pair().selectedAt,boundary:[],destinations:[{id:'a',path:'A.md'},{id:'b',path:'B.md'}],bindings:[]};
  let mode:'free'|'one-to-one'='one-to-one',reads=0;
  const host:DisplayHost={validateRelation:async(source,paths)=>assertThreadNoteMode(mode,entries,undefined,source,paths),readThread:async()=>{reads++;return {historyComplete:true,messages:[],activities:[]};},validateDestination:async()=>{},responseBindings:async()=>[],prepareDisplay:async()=>{throw Error('no response');},attachDisplay:async()=>{},save:async()=>{}};
  const before=JSON.stringify(display);
  await assert.rejects(tickDisplay(display,host),/1:1 mode/);assert.equal(reads,0);assert.equal(JSON.stringify(display),before);
  await assert.rejects(displayCommand([], {version:1,id:display.id,kind:'stream-thread',scope:'thread',source:target,destinations:['B.md']},host,0),/1:1 mode/);
  mode='free';await tickDisplay(display,host);assert.equal(reads,1);assert.equal(JSON.stringify(display),before);
});

test('legacy local links use the resolved environment and shared mode loading keeps the migration default',async()=>{
  const {p}=await pluginFixture();p.localInlineEnvironment=async()=> 'machine';
  p.settings.noteThreads=[{...pair(),connectionId:'',environmentId:undefined}];
  await assert.doesNotReject(p.assertNoteMode('A.md',{projectId:'project',threadId:'one'}));
  await assert.rejects(p.assertNoteMode('B.md',{projectId:'project',threadId:'one'}),/1:1 mode/);
  assert.equal(p.sharedData({threadNoteMode:'one-to-one'}).threadNoteMode,'one-to-one');
  assert.equal(p.sharedData({}).threadNoteMode,'free');
});
