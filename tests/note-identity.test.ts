import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from './obsidian-context';
import {webcrypto} from 'node:crypto';
import {noteIdentity,noteIdentityMarker,withNoteIdentity} from '../src/notes/note-identity';
import {loadSmartSend,smartNote,moveSmartNotes,mergeSmartSend,prepareSmartSend} from '../src/notes/smart-send';
import {bindNoteThreadIds,lastUsedNoteThread,mergeNoteThreads,mutateNoteThreads,resolveNoteThreadPaths,type NoteThread} from '../src/notes/note-threads';

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
  p.app={workspace:{getActiveViewOfType:()=>undefined,getLeavesOfType:()=>[]},vault:{getFileByPath:(path:string)=>files.get(path),getAbstractFileByPath:(path:string)=>files.get(path),getMarkdownFiles:()=>assert.fail('Vault enumeration is retired'),getName:()=> 'Test',adapter:{},read:async(file:any)=>{reads++;return file.text;},process:async(file:any,change:any)=>file.text=change(file.text)}};
  const project={id:'project',title:'Test project',workspaceRoot:'/project'};
  p.settings={smartSend:smart,threadNoteMode:'free',noteThreads:[link(id)],noteContexts:[],projects:[project],directProjects:[],paired:[],folderLinks:[],responseBindings:{},inlineStreaming:{enabled:false},pending:[],completion:{action:'keep'},completionJobs:[],settlementJobs:[]};
  p.save=async()=>{saves++;};p.mode='desktop';p.localNoProjectId='machine';p.eventLocalEnvironmentId='machine';
  p.connection=()=>({environmentId:'machine'});p.projectForNoteThread=()=>project;p.readChatThread=async()=>({id:'thread',projectId:'project',title:'Original conversation'});
  p.previewSend=()=>()=>{};p.requestTitle=async()=> 'Original conversation';p.prepareImages=async(markdown:string)=>({markdown});p.recordSendFailure=()=>{};
  const dispatched:any[]=[];p.dispatch=async(request:any)=>{dispatched.push(request);return request.threadId;};
  return {p,id,files,put,notices,dispatched,reads:()=>reads,saves:()=>saves};
}

for(const mode of ['free','one-to-one'])test(`an observed move retains its linked thread in ${mode} without reading other notes`,async()=>{
 const h=await fixture();h.p.settings.threadNoteMode=mode;h.put(moved,withNoteIdentity('Request.',h.id));
 await h.p.relocateNoteThreads(old,moved);assert.equal(h.p.noteThread(moved).threadId,'thread');assert.equal(h.p.noteThread(old),undefined);assert.equal(h.reads(),0);
});

test('a copy gets independent source and cannot take its original thread',async()=>{
 const h=await fixture(),text=withNoteIdentity('Same source.',h.id);h.put(old,text);h.put(moved,text);
 assert.equal(h.p.noteThread(moved),undefined);assert.equal(h.p.noteThread(old).threadId,'thread');
 const copy=smartNote(h.p.smartData(),moved);assert.notEqual(copy,h.id);await h.p.ensureNoteIdentity(moved,copy);
 assert.equal(noteIdentity(h.files.get(moved)!.text),copy);assert.equal(noteIdentity(h.files.get(old)!.text),h.id);
});

test('an unobserved move starts fresh at the explicit path, preserving prose without recovering another thread',async()=>{
 const h=await fixture(),text=withNoteIdentity('User text and saved output.',h.id);h.put(moved,text);
 const fresh=smartNote(h.p.smartData(),moved);await h.p.ensureNoteIdentity(moved,fresh);
 assert.notEqual(fresh,h.id);assert.equal(h.p.noteThread(moved),undefined);assert.equal(noteIdentity(h.files.get(moved)!.text),fresh);assert.equal(h.files.get(moved)!.text,text.replace(h.id,fresh));
 const before=h.files.get(moved)!.text;await assert.rejects(h.p.ensureNoteIdentity(moved,'f'.repeat(64)),/identity changed/);assert.equal(h.files.get(moved)!.text,before);
});

test('legacy saved progress does not restore a missed thread link by searching the vault',async()=>{
 const h=await fixture();h.p.settings.noteThreads=[link()];const text='> [!t3-progress]- **Original conversation · Completed**\n> Saved output.\n\nNew request.\n';h.put(moved,text);
 assert.equal(h.p.noteThread(moved),undefined);assert.equal(h.reads(),0);assert.equal(h.files.get(moved)!.text,text);
});

test('known stable IDs stay linked when shared source metadata has already followed an observed move',async()=>{
 const h=await fixture();moveSmartNotes(h.p.smartData(),old,moved);h.put(moved,withNoteIdentity('Request.',h.id));
 assert.equal(h.p.noteThread(moved).threadId,'thread');h.p.settings.smartSend=mergeSmartSend(h.p.smartData());assert.equal(h.p.noteThread(moved).threadId,'thread');
});
