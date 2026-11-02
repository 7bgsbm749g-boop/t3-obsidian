import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {noteIdentity,noteIdentityMarker,withNoteIdentity,uniqueNoteLocation} from '../note-identity';
import {loadSmartSend,smartNote,moveSmartNotes,mergeSmartSend,prepareSmartSend,confirmSmartSend} from '../smart-send';
import {bindNoteThreadIds,lastUsedNoteThread,mergeNoteThreads,mutateNoteThreads,resolveNoteThreadPaths,type NoteThread} from '../note-threads';

const old='Original/Note.md',moved='Renamed/Subfolder/Moved.md';
const link=(noteId?:string):NoteThread=>({notePath:old,noteId,threadId:'thread',projectId:'project',connectionId:'',environmentId:'machine',workspaceRoot:'/project',selectedAt:'2026-10-30T00:00:00.000Z'});

test('note IDs survive editing, exclude literal examples and cannot have two owners in one note',async()=>{
  const id='a'.repeat(64),marker=noteIdentityMarker(id),document=withNoteIdentity('# User text\n',id);
  assert.equal(noteIdentity(document),id);assert.equal(withNoteIdentity(document,id),document);
  assert.equal(noteIdentity('```md\n'+marker+'\n```'),undefined);
  assert.equal(noteIdentity('> '+marker),undefined);
  assert.throws(()=>noteIdentity(marker+'\n'+marker),/several T3 note IDs/);
  const data=loadSmartSend(undefined);
  assert.equal((await prepareSmartSend(data,old,'destination',document)).text.trim(),'# User text');
  assert.match((await prepareSmartSend(data,old,'destination','```md\n'+marker+'\n```')).text,/t3-note-id/,'Literal examples remain user source');
});

test('a missed-move scan refuses copies and propagates read failures instead of picking a first result',async()=>{
  const id='a'.repeat(64),marker=noteIdentityMarker(id),files=new Map([['One.md',marker],['Two.md',marker]]);
  await assert.rejects(uniqueNoteLocation(text=>noteIdentity(text)===id,[...files.keys()],async path=>files.get(path)),/several notes/);
  await assert.rejects(uniqueNoteLocation(()=>true,['Unreadable.md'],async()=>{throw Error('Read failed');}),/Read failed/);
  files.delete('One.md');assert.equal(await uniqueNoteLocation(text=>noteIdentity(text)===id,[...files.keys()],async path=>files.get(path)),'Two.md');
});

test('stable thread links preserve last use through moves, stale deletions, reload and subsequent real deletion',()=>{
  const data=loadSmartSend(undefined),id=smartNote(data,old),entries=bindNoteThreadIds([link()],data.notes);
  const stale=mutateNoteThreads(entries,old,undefined,false,Date.now()+10000);
  moveSmartNotes(data,old,moved,true);
  const renamed=mutateNoteThreads(entries,old,moved,false,0);
  for(const merged of [mergeNoteThreads(stale,renamed),mergeNoteThreads(renamed,stale)]){
    const current=resolveNoteThreadPaths(merged,data.notes);
    assert.equal(lastUsedNoteThread(current,moved)?.threadId,'thread');
    assert.equal(lastUsedNoteThread(current,moved)?.selectedAt,link().selectedAt);
    assert.equal(lastUsedNoteThread(current,old),undefined);
    const deleted=mutateNoteThreads(current,moved);
    assert.equal(lastUsedNoteThread(mergeNoteThreads(deleted,renamed),moved),undefined);
  }
});

async function fixture(){
  class Base{}
  const notices:string[]=[],api={Plugin:Base,PluginSettingTab:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,MarkdownView:Base,Notice:class{constructor(value:string){notices.push(value);}},Platform:{isMobile:false}};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},crypto:webcrypto,URL,TextEncoder,TextDecoder,AbortController,console,setTimeout,clearTimeout,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})}});
  const p=new module.exports.default(),smart=loadSmartSend(undefined),id=smartNote(smart,old),files=new Map<string,{path:string;extension:string;stat:{ctime:number};text:string}>();
  const put=(path:string,text:string)=>{files.set(path,{path,extension:'md',stat:{ctime:1},text});};
  let reads=0,saves=0;
  p.app={workspace:{getActiveViewOfType:()=>undefined,getLeavesOfType:()=>[]},vault:{getFileByPath:(path:string)=>files.get(path),getAbstractFileByPath:(path:string)=>files.get(path),getMarkdownFiles:()=>[...files.values()],getName:()=> 'Test',adapter:{},read:async(file:any)=>{reads++;return file.text;},process:async(file:any,change:any)=>file.text=change(file.text)}};
  const project={id:'project',title:'Test project',workspaceRoot:'/project'};
  p.settings={smartSend:smart,threadNoteMode:'free',noteThreads:[link(id)],noteContexts:[],projects:[project],directProjects:[],paired:[],folderLinks:[],responseBindings:{},inlineStreaming:{enabled:false},pending:[],completion:{action:'keep'},completionJobs:[],settlementJobs:[]};
  p.save=async()=>{saves++;};p.mode='desktop';p.localNoProjectId='machine';p.eventLocalEnvironmentId='machine';
  p.connection=()=>({environmentId:'machine'});p.projectForNoteThread=()=>project;p.readChatThread=async()=>({id:'thread',projectId:'project',title:'Original conversation'});
  p.previewSend=()=>()=>{};p.requestTitle=async()=> 'Original conversation';p.prepareImages=async(markdown:string)=>({markdown});p.recordSendFailure=()=>{};
  const dispatched:any[]=[];p.dispatch=async(request:any)=>{dispatched.push(request);return request.threadId;};
  return {p,id,files,put,notices,dispatched,reads:()=>reads,saves:()=>saves};
}

for(const mode of ['free','one-to-one'])test(`real default Send recovers a missed folder/file move before choosing a thread in ${mode}`,async()=>{
  const h=await fixture();h.p.settings.threadNoteMode=mode;
  const base=await prepareSmartSend(h.p.smartData(),old,JSON.stringify(['machine','project','thread']),'Original request.');
  confirmSmartSend(h.p.smartData(),'accepted',JSON.stringify(['machine','project','thread']),base.capture);
  h.put(moved,withNoteIdentity('Original request.\nNew request.',h.id));
  await h.p.openNoteSend(h.files.get(moved));
  assert.deepEqual(h.notices,[]);assert.equal(h.dispatched.length,1);
  assert.equal(h.dispatched[0].threadId,'thread');assert.equal(h.dispatched[0].prompt.trim().startsWith('New request.'),true);
  assert.doesNotMatch(h.dispatched[0].prompt,/Original request|t3-note-id/);
  assert.equal(h.p.noteThread(moved).selectedAt,link().selectedAt);
  assert.equal(h.p.noteThread(old),undefined);
  const before=h.reads();await h.p.recoverNoteThread(moved);assert.equal(h.reads()-before,1,'Known locations need one note read, not a vault scan');
});

test('a copy with an existing original gets independent source and cannot take the original thread',async()=>{
  const h=await fixture(),text=withNoteIdentity('Same source.',h.id);h.put(old,text);h.put(moved,text);
  await h.p.recoverNoteThread(moved);
  assert.equal(h.p.noteThread(moved),undefined);assert.equal(h.p.noteThread(old).threadId,'thread');
  const copy=smartNote(h.p.smartData(),moved);assert.notEqual(copy,h.id);
  await h.p.ensureNoteIdentity(moved,copy);
  assert.equal(noteIdentity(h.files.get(moved)!.text),copy);assert.equal(noteIdentity(h.files.get(old)!.text),h.id);
});

test('two moved copies and unknown synced IDs block default Send before dispatch',async()=>{
  const h=await fixture(),text=withNoteIdentity('Request.',h.id);h.put(moved,text);h.put('Other.md',text);
  await h.p.openNoteSend(h.files.get(moved));assert.equal(h.dispatched.length,0);assert.match(h.notices[0],/several notes/);
  h.files.delete('Other.md');h.p.settings.smartSend=loadSmartSend(undefined);h.p.smartReplica=loadSmartSend(undefined);
  await assert.rejects(h.p.recoverNoteThread(moved),/no thread history/);
});

test('legacy completed progress restores the link after a missed move without changing the note',async()=>{
  const h=await fixture();h.p.settings.noteThreads=[link()];
  const key='thread%3A2026-10-30T00%3A00%3A00.000Z%3A0:complete',text='> [!t3-progress]- **Original conversation · Completed** <span class="send-to-t3-fold-key" data-t3-fold="'+key+'"></span>\n>\n> Saved output.\n\nNew request.\n';
  h.put(moved,text);await h.p.recoverNoteThread(moved);
  assert.equal(h.p.noteThread(moved).threadId,'thread');assert.equal(h.p.noteThread(moved).selectedAt,link().selectedAt);
  assert.equal(h.files.get(moved)!.text,text);
});

test('known stable IDs remain linked when source metadata has already followed a remote move',async()=>{
  const h=await fixture();moveSmartNotes(h.p.smartData(),old,moved);
  h.put(moved,withNoteIdentity('Request.',h.id));await h.p.recoverNoteThread(moved);
  assert.equal(h.p.noteThread(moved).threadId,'thread');
  const reload=mergeSmartSend(h.p.smartData());h.p.settings.smartSend=reload;
  assert.equal(h.p.destinationContext({path:moved}).getDefaultThread(),'thread');
});
