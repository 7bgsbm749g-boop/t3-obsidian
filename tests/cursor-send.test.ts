import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {createRequire} from 'node:module';
import {webcrypto,randomUUID} from 'node:crypto';
import {captureCursorInsertion,resolveCursorInsertion} from '../src/notes/cursor-insertion';
import {responseAnchor} from '../src/responses/native-response-projection';
import {applyThreadItem} from '../src/conversations/inline-thread';
import {installPaletteChat} from '../src/conversations/palette-chat';
import {loadSmartSend} from '../src/notes/smart-send';
import {sendDirect} from '../src/connection/direct';

const require=createRequire(import.meta.url);
const compiled=build({stdin:{contents:"export {default} from './src/app/main'; export {RequestDeliveryError} from './src/app/bridge'; export {nativeResponses} from './src/responses/native-response-manager'; export {InlineChatManager} from './src/conversations/inline-chat';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',external:['obsidian'],write:false});
async function fixture(document='First paragraph.\n\nLater paragraph.'){
  class Base{}
  const api={Plugin:Base,MarkdownView:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile:false}};
  const module={exports:{} as any};
  runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?api:require(id),process,Buffer,Uint8Array,console,TextEncoder,TextDecoder,crypto:webcrypto,URL,setTimeout,clearTimeout,setInterval,clearInterval,performance,AbortController});
  let value=document,disk=document,cursor=document.indexOf('Later')-1,mode='source',active=true,selection: [number,number]|undefined;
  const file={path:'Note.md',extension:'md'};
  const editor={getValue:()=>value,getCursor:(which?:string)=>selection?(which==='from'?selection[0]:selection[1]):cursor,getSelection:()=>selection?value.slice(...selection):'',posToOffset:(position:number)=>position,offsetToPos:(offset:number)=>offset,replaceRange:(text:string,from:number,to=from)=>{value=value.slice(0,from)+text+value.slice(to);}};
  const view={file,editor,getViewData:()=>value,setViewData:(text:string)=>{value=text;},getMode:()=>mode,requestSave:()=>{},save:async()=>{disk=view.getViewData();}};
  const app={loadLocalStorage:()=>undefined,saveLocalStorage:()=>{},workspace:{getActiveFile:()=>file,getActiveViewOfType:()=>active?view:undefined,getLeavesOfType:()=>[{view}]},vault:{adapter:{getFullPath:(path:string)=>'/vault/'+path},getName:()=> 'Synthetic',getFileByPath:()=>file,read:async()=>disk}};
  const plugin=new module.exports.default();plugin.app=app;plugin.settings={inlineStreaming:{enabled:true},noteThreads:[]};plugin.save=async()=>{};
  return {plugin,app,view,editor,file,exports:module.exports,value:()=>value,cursor:(offset:number)=>{cursor=offset;selection=undefined;},select:(from:number,to:number)=>{selection=[from,to];},active:(yes:boolean)=>{active=yes;},mode:(next:string)=>{mode=next;}};
}

test('whole-note Send shows Preparing before discovery, keeps Sending after selection, and clears failure',async()=>{
  const h=await fixture(),document=h.value(),events:string[]=[];
  h.plugin.sendPreviews={preparing:()=>{events.push('preparing');return ()=>events.push('prepared');},begin:()=>{events.push('show');return ()=>events.push('clear');}};
  let resolve!:(target:any)=>void;const gate=new Promise(done=>{resolve=done;});
  h.plugin.chatTarget=async()=>{events.push('lookup');return gate;};
  h.plugin.projectReadinessError=()=>undefined;
  h.plugin.send=async()=>{events.push('send');throw Error('Synthetic preparation failure');};
  const sending=h.plugin.sendNote(h.file,undefined,undefined,true);
  assert.equal(h.value(),document);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['preparing','lookup']);
  resolve({project:{id:'scratch'},link:{id:'no-project'}});await assert.rejects(sending,/Synthetic preparation failure/);
  assert.deepEqual(events,['preparing','lookup','show','send','clear','prepared']);assert.equal(h.value(),document);
});

test('Inline Off does not create a preparation block',async()=>{
  const h=await fixture(),original=h.value();
  h.plugin.sendPreviews={preparing:()=>()=>{},begin:()=>assert.fail('Disabled inline streaming must not create a preview')};
  h.plugin.chatTarget=async()=>{throw Error('Synthetic cancellation');};
  await assert.rejects(h.plugin.sendNote(h.file,undefined,undefined,true,undefined,{inline:{enabled:false,intermediateMode:'collapse',finalAnswerFormat:'formatted'}}),/Synthetic cancellation/);
  assert.equal(h.value(),original);
});

test('Ask waits for its destination then shows the indicator and hands off to one real block',async()=>{
  const h=await fixture(),original=h.value(),events:string[]=[],manager=new h.exports.InlineChatManager(h.app,'jobs',async()=>undefined);
  h.plugin.sendPreviews={begin:()=>{events.push('show');return ()=>events.push('clear');},hide:()=>events.push('handoff')};
  manager.prepare=async()=>{};manager.start=()=>{};h.plugin.inlineChat=manager;
  let ready!:()=>void;const gate=new Promise<void>(resolve=>{ready=resolve;});
  h.plugin.sendChat=async(_prompt:any,_note:any,options:any)=>{await gate;options.onTargetResolved();assert.deepEqual(events,['show']);await options.onPrepared({id:options.requestId,title:'Synthetic'});};
  const sending=h.plugin.sendInlineChat('Explain',{path:h.file.path},{editor:h.editor,view:h.view,insertion:captureCursorInsertion(original,3)},{newThread:true});
  assert.deepEqual(events,[]);assert.equal(h.value(),original);
  ready();await sending;
  assert.deepEqual(events,['show','handoff','clear']);assert.equal(h.value().split('<!-- t3-inline:start:').length-1,1);
  assert.ok(h.value().indexOf('t3-inline:end:')<h.value().indexOf('Later paragraph.'));manager.dispose();
});

test('Ask leaves the reply available when T3 loses the send acknowledgement',async()=>{
  const h=await fixture(),manager=new h.exports.InlineChatManager(h.app,'jobs',async()=>undefined);
  h.plugin.sendPreviews={begin:()=>()=>{},hide:()=>{}};
  manager.prepare=async()=>{};
  manager.deliveryFailed=async()=>assert.fail('Unconfirmed delivery must preserve the reply');
  h.plugin.inlineChat=manager;
  h.plugin.sendChat=async(_prompt:any,_note:any,options:any)=>{
    await options.onPrepared({id:options.requestId,title:'Synthetic'});
    throw new h.exports.RequestDeliveryError('Delivery unconfirmed',false,true,true);
  };
  await assert.rejects(h.plugin.sendInlineChat('Ask',{path:h.file.path},{editor:h.editor,view:h.view},{newThread:true}),/Delivery unconfirmed/);
  assert.match(h.value(),/t3-inline:start:/);
  manager.dispose();
});

for(const question of ['', 'Why this passage?'])test(`palette selection ${question?'questions':'sends'} stay below the selected occurrence after focus clears it`,async()=>{
  const passage='Repeated passage.',document=passage+'\n\nBetween paragraphs.\n\n'+passage+'\n\nLater paragraph.',h=await fixture(document),start=document.lastIndexOf(passage);
  const manager=new h.exports.InlineChatManager(h.app,'jobs',async()=>undefined),errors:unknown[]=[];
  manager.prepare=async()=>{};manager.start=()=>{};h.plugin.inlineChat=manager;
  h.plugin.recoverSmartReplies=async()=>{};h.plugin.smartData=()=>loadSmartSend(undefined);
  h.plugin.sendChat=async(_prompt:any,_note:any,options:any)=>options.onPrepared({id:randomUUID(),title:'Synthetic'});
  let sending:Promise<void>|undefined;
  h.plugin.openChatWithNote=(note:any,prompt:any,context:any)=>h.plugin.sendInlineChat(prompt,note,context,{newThread:true});
  const modal={inputEl:Object.assign(new EventTarget(),{value:question}),getSuggestions:()=>[],renderSuggestion:()=>{},selectSuggestion(row:any,event:any){h.cursor(document.length);return this.onChooseSuggestion(row,event);},onChooseSuggestion:(_row:any,_event:any)=>{},onOpen:()=>{h.cursor(document.length);}};
  h.select(start,start+passage.length);
  const hook=installPaletteChat({internalPlugins:{getPluginById:()=>({instance:{modal}})}},(prompt,selection,choose,source)=>sending=h.plugin.openPaletteAction(prompt,selection,choose,source),{captureSource:()=>h.plugin.capturePaletteSource(),onError:error=>errors.push(error)});
  modal.onOpen();const row=(modal.getSuggestions as any)(question)[0];modal.selectSuggestion(row,{});
  await sending;
  assert.deepEqual(errors,[]);assert.ok(sending);
  const marker=h.value().indexOf('<!-- t3-inline:start:');
  assert.ok(marker>start+passage.length);assert.ok(marker<h.value().indexOf('Later paragraph.'));
  assert.equal(h.value().slice(0,start+passage.length),document.slice(0,start+passage.length));
  hook.dispose();manager.dispose();
});

test('a changed selection without a captured anchor cannot silently append a response',async()=>{
  const h=await fixture();h.cursor(h.value().length);
  h.plugin.openChatWithNote=()=>assert.fail('a stale selection must not send');
  await assert.rejects(h.plugin.openManualAction(h.file,'Why?','First paragraph.'),/selected text changed/);
  h.select(0,'First paragraph.'.length);
  const captured=h.plugin.capturePaletteSource().context.editor;
  h.view.file={...h.file,path:'Other.md'};
  await assert.rejects(h.plugin.openManualAction(h.file,'Why?','First paragraph.',captured),/original note is no longer open/);
  await assert.rejects(h.plugin.openManualAction(h.file,'Explain without a selection','',captured),/original note is no longer open/);
});

test('a selection used as reference keeps its position instead of falling back to the note end',async()=>{
  const prefix='Earlier material.\n'.repeat(12),h=await fixture(prefix+'First paragraph.\n\nLater paragraph.'),manager=new h.exports.InlineChatManager(h.app,'jobs',async()=>undefined);
  h.select(prefix.length,prefix.length+'First paragraph.'.length);
  const context=h.plugin.capturePaletteSource().context.editor;context.referenceSelection=true;
  manager.prepare=async()=>{};manager.start=()=>{};h.plugin.inlineChat=manager;
  const data=loadSmartSend(undefined),sent:any[]=[];h.plugin.settings.pending=[];
  h.plugin.chatTarget=async()=>({project:{id:'scratch'},link:{}});h.plugin.projectReadinessError=()=>undefined;
  h.plugin.connection=()=>({});h.plugin.assertNoteMode=async()=>{};h.plugin.recoverSmartReplies=async()=>{};
  h.plugin.smartData=()=>data;h.plugin.smartKey=async()=> 'synthetic';h.plugin.requestTitle=async()=> 'Synthetic';
  h.plugin.prepareImages=async(markdown:string)=>({markdown,attachments:[]});h.plugin.noteThreadIntent=()=>undefined;h.plugin.folderLinkIntent=()=>({});
  h.plugin.prepareNoteSteering=async()=>false;h.plugin.dispatch=async(request:any)=>{sent.push(request);};
  h.plugin.openChatWithNote=(note:any,prompt:any,current:any)=>{
    assert.equal(current.smartDocument.slice(...current.smartScope),'First paragraph.');
    return h.plugin.sendInlineChat(prompt,note,current,{newThread:true});
  };
  h.editor.replaceRange('New preceding text.\n',0);h.cursor(h.value().length);
  await h.plugin.openManualAction(h.file,'Explain','First paragraph.',context);
  assert.equal(sent.length,1);assert.match(sent[0].prompt,/Selected text:\nFirst paragraph\./);assert.doesNotMatch(sent[0].prompt,/Later paragraph/);
  assert.ok(h.value().indexOf('t3-inline:end:')<h.value().indexOf('Later paragraph.'));
  manager.dispose();
});

test('selecting a projected response places a new answer outside that response and above later prose',async()=>{
  const oldId=randomUUID(),document='Before\n\n'+responseAnchor(oldId)+'\n\nLater paragraph.',h=await fixture(document);
  const adapter=h.exports.nativeResponses(h.app).wrap(h.view,document);
  adapter.setResponses([{id:oldId,body:'Selected generated passage.\n\nMore generated text.'}]);
  const start=h.value().indexOf('Selected generated');h.select(start,start+'Selected generated passage.'.length);
  const context=h.plugin.capturePaletteSource().context.editor;
  assert.equal(context.referenceSelection,true);
  const manager=new h.exports.InlineChatManager(h.app,'jobs',async()=>undefined);
  manager.prepare=async()=>{};manager.start=()=>{};h.plugin.inlineChat=manager;
  h.plugin.sendChat=async(_prompt:any,_note:any,options:any)=>options.onPrepared({id:randomUUID(),title:'Synthetic'});
  await h.plugin.sendInlineChat('Explain',{path:h.file.path},context,{newThread:true});
  const at=h.value().indexOf('<!-- t3-inline:start:');
  assert.ok(at>h.value().indexOf('More generated text.'));
  assert.ok(h.value().indexOf('t3-inline:end:')<h.value().indexOf('Later paragraph.'));
  manager.dispose();h.exports.nativeResponses(h.app).dispose();
});

for(const question of ['', 'Explain'])test(`palette ${question?'questions without selection':'whole-note sends'} keep the captured cursor after activation`,async()=>{
  const h=await fixture(),document=h.value(),source=h.plugin.capturePaletteSource(),sent:any[]=[];
  h.plugin.openNoteSend=(_file:any,_choose:any,insertion:any)=>{sent.push(insertion);};
  h.plugin.openChatWithNote=(_note:any,_prompt:any,context:any)=>{sent.push(context.insertion);};
  h.cursor(document.length);await h.plugin.openPaletteAction(question,'',false,source.context);
  assert.equal(sent.length,1);assert.equal(resolveCursorInsertion(document,sent[0]),document.indexOf('Later')-1);
});

for(const remembered of [false,true])test(`whole-note ${remembered?'continued':'new'} sends retain the cursor from activation across async routing`,async()=>{
  const h=await fixture(),initial=h.value(),offset=initial.indexOf('Later')-1;
  let ready!:()=>void;const gate=new Promise<void>(resolve=>{ready=resolve;}),sent:any[]=[];
  // Exercise dispatch after confirmation; first-send chooser coverage is separate.
  h.plugin.destinationContext=()=>({hasConfirmedNoteSend:()=>true,getDefaultProjectKey:()=> 'project',getDefaultThread:()=>remembered?'thread':undefined,getNotePath:()=>h.file.path});
  h.plugin.hasSmartContent=async()=>{await gate;return true;};
  h.plugin.sendNote=async(...args:any[])=>{sent.push(args);};
  const sending=h.plugin.openNoteSend(h.file);h.cursor(initial.length);ready();await sending;
  assert.equal(sent.length,1);assert.equal(sent[0][3],!remembered);
  assert.equal(resolveCursorInsertion(initial,sent[0][6]),offset);
});

test('file and reading-view sends have no cursor hint, even if another editor opens later',async()=>{
  const h=await fixture();h.active(false);assert.equal(h.plugin.noteSendInsertion(h.file),null);
  h.active(true);h.mode('preview');assert.equal(h.plugin.noteSendInsertion(h.file),null);
  h.mode('source');assert.equal(h.plugin.noteSendInsertion({...h.file,path:'Other.md'}),null);
  let ready!:()=>void;const gate=new Promise<void>(resolve=>{ready=resolve;}),sent:any[]=[];
  h.active(false);h.plugin.destinationContext=()=>({hasConfirmedNoteSend:()=>true,getDefaultThread:()=>undefined,getNotePath:()=>h.file.path});
  h.plugin.hasSmartContent=async()=>{await gate;return true;};h.plugin.sendNote=async(...args:any[])=>{sent.push(args);};
  const sending=h.plugin.openNoteSend(h.file);h.active(true);ready();await sending;assert.equal(sent[0][6],null);
});

test('whole-note cursor offsets use saved text after a projected response and stay outside its boundaries',async()=>{
  const id=randomUUID(),document='Before\n\n'+responseAnchor(id)+'\n\nLater paragraph.',h=await fixture(document);
  const adapter=h.exports.nativeResponses(h.app).wrap(h.view,document);
  adapter.setResponses([{id,body:'A long streamed response.\n\nMore streamed text.'}]);
  h.cursor(h.value().indexOf('Later')-1);
  const insertion=h.plugin.noteSendInsertion(h.file);
  assert.equal(insertion.document,document);assert.equal(insertion.offset,document.indexOf('Later')-1);
  h.cursor(h.value().indexOf('long streamed'));
  assert.ok(h.plugin.noteSendInsertion(h.file).offset>=document.indexOf(responseAnchor(id))+responseAnchor(id).length);
  h.exports.nativeResponses(h.app).dispose();
});

test('an Ask without selection reserves at its captured cursor, with a separate paragraph on each side',async()=>{
  const h=await fixture(),original=h.value(),insertion=captureCursorInsertion(original,3),id=randomUUID();
  const manager=new h.exports.InlineChatManager(h.app,'jobs',async()=>undefined);
  manager.prepare=async()=>{};manager.start=()=>{};h.plugin.inlineChat=manager;
  h.plugin.sendChat=async(_prompt:any,_note:any,options:any)=>options.onPrepared({id,title:'Synthetic'});
  h.cursor(original.length);
  await h.plugin.sendInlineChat('Explain',{path:h.file.path},{editor:h.editor,view:h.view,insertion},{newThread:true});
  assert.match(h.value(),/^First paragraph\.\n\n<!-- t3-inline:start:/);
  assert.ok(h.value().indexOf('t3-inline:end:')<h.value().indexOf('Later paragraph.'));
  manager.dispose();
});

for(const state of ['completed','running'])for(const cursor of [3,'First paragraph.\n'.length])test(`${state} imports use the captured cursor and replay without moving or duplicating the response (${cursor})`,async()=>{
  const h=await fixture(),original=h.value(),insertion=h.plugin.noteSendInsertion(h.file),messageId=randomUUID(),threadId=randomUUID(),project={id:'project'},registered:any[]=[];
  h.cursor(cursor);const captured=h.plugin.noteSendInsertion(h.file);h.cursor(original.length);
  let ready!:()=>void;const gate=new Promise<void>(resolve=>{ready=resolve;});
  const history=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{messages:[{id:messageId,role:'user',text:'Synthetic prompt',createdAt:'2026-10-16T00:00:00Z',turnId:null,streaming:false},{id:'answer',role:'assistant',text:'Imported answer',createdAt:'2026-10-16T00:00:00Z',turnId:'turn',streaming:state==='running'}],activities:[],latestTurn:{turnId:'turn',requestedAt:'2026-10-16T00:00:00Z',state},session:{status:state==='running'?'running':'ready',activeTurnId:state==='running'?'turn':null}}}}).state;
  h.plugin.settings.vaultId='synthetic';h.plugin.deviceInline={register:async(request:any)=>{registered.push(request);},waitForSave:async()=>({saved:true})};
  h.plugin.readImportHistory=async()=>{await gate;return {source:{threadId,projectId:project.id,environmentId:'machine'},state:history,title:'Imported run'};};
  h.plugin.connection=()=>({environmentId:'machine'});h.plugin.localResponseTarget=async()=>({environmentId:'machine',workspaceRoot:'/vault',directory:'.obsidian/inline'});
  const importing=h.plugin.importRun(h.file.path,project,threadId,messageId,false,captured);h.cursor(0);ready();
  assert.equal((await importing).duplicate,false);assert.equal(registered.length,1);
  const anchor=responseAnchor(registered[0].id),at=h.value().indexOf(anchor);
  assert.ok(at>h.value().indexOf('First paragraph.'));assert.ok(at<h.value().indexOf('Later paragraph.'));
  const once=h.value();assert.equal((await h.plugin.importRun(h.file.path,project,threadId,messageId,false,insertion)).duplicate,true);
  assert.equal(h.value(),once);assert.equal(registered.length,2);assert.equal(registered[0].id,registered[1].id);
});


test('verified No project reuse is exact and invalidates on removal, workspace or identity changes',async()=>{
  const h=await fixture(),p=h.plugin;
  const paired={id:'machine',environmentId:'env',url:'https://example.invalid',name:'Synthetic'};
  p.settings={...p.settings,paired:[paired],directProjects:[],vaultId:'vault'};
  let reads=0;p.readNoProjectProject=async()=>{reads++;return {id:'scratch',title:'No project',workspaceRoot:'/scratch'};};
  const target=()=>p.noProjectTarget('thread:no-project:machine',false);
  const first=await target();assert.equal(reads,1);assert.equal((await target()).project,first.project);assert.equal(reads,1);
  p.settings.directProjects=[];await target();assert.equal(reads,2);
  p.settings.directProjects[0].workspaceRoot='/changed';await target();assert.equal(reads,3);
  paired.environmentId='different';await target();assert.equal(reads,4);
  paired.url='https://other.invalid';await target();assert.equal(reads,5);
  p.cloudGeneration++;await target();assert.equal(reads,6);
  p.settings.vaultId='other';await target();assert.equal(reads,7);
  p.nativeAccount={userId:'other-account'};await target();assert.equal(reads,8);
  p.settings.paired=[];await assert.rejects(target(),/Reconnect/);assert.equal(reads,8);
});

test('a late No project result cannot repopulate another connection identity',async()=>{
  const h=await fixture(),p=h.plugin;
  p.settings={...p.settings,paired:[{id:'machine',environmentId:'env',url:'https://example.invalid'}],directProjects:[],vaultId:'vault'};
  let release!:(value:any)=>void;p.readNoProjectProject=()=>new Promise(resolve=>{release=resolve;});
  const pending=p.noProjectTarget('thread:no-project:machine',false);p.cloudGeneration++;
  release({id:'scratch',title:'No project',workspaceRoot:'/scratch'});
  await assert.rejects(pending,/connection changed/);assert.equal(p.noProjectProjects.size,0);assert.equal(p.settings.directProjects.length,0);
});

test('only matching per-send title metadata skips the duplicate read; other paths read fresh',async()=>{
  const h=await fixture(),connection={connectionId:'c',environmentId:'e'},project={id:'p'};
  const thread={id:'t',projectId:'p',title:'Current title',session:{status:'ready'}};
  const preparation=h.plugin.titlePreparation(connection,thread);
  let reads=0;h.plugin.readChatThread=async()=>{reads++;return {...thread,title:'Fresh title'};};
  assert.equal(await h.plugin.requestTitle(connection,project,'t','Note.md',preparation),'Current title');
  assert.equal(reads,0);
  assert.equal(preparation.thread.session,undefined,'the context must not retain control authority');
  thread.title='Changed after capture';assert.equal(preparation.thread.title,'Current title');
  const invalids=[undefined,{...preparation,environmentId:'other'},{...preparation,connectionId:'other'},{...preparation,thread:{...thread,id:'other'}},{...preparation,thread:{...thread,projectId:'other'}},{...preparation,thread:{...thread,archivedAt:'now'}},{...preparation,thread:{...thread,deletedAt:'now'}}];
  for(const invalid of invalids)assert.equal(await h.plugin.requestTitle(connection,project,'t','Note.md',invalid),'Fresh title');
  assert.equal(reads,invalids.length);
  h.plugin.readChatThread=async()=>{throw Error('Unavailable thread');};
  await assert.rejects(h.plugin.requestTitle(connection,project,'t','Note.md'),/Unavailable thread/);
});

for(const race of ['unchanged','approval','stopped'])test(`a prepared title keeps fresh dispatch authority when ${race}`,async()=>{
  const h=await fixture(),project={id:'p',title:'P',workspaceRoot:'/'},connection={connectionId:'c',environmentId:'e',host:'direct',executable:''};
  const thread={id:'t',projectId:'p',title:'Selected title',session:{status:'ready'}};
  const preparation=h.plugin.titlePreparation(connection,thread);
  h.plugin.settings.pending=[];h.plugin.chatTarget=async()=>({project,link:{}});h.plugin.connection=()=>connection;
  h.plugin.projectReadinessError=()=>undefined;h.plugin.assertNoteMode=async()=>{};h.plugin.folderLinkIntent=()=>({});
  h.plugin.readChatThread=async()=>assert.fail('No second title-only read');
  h.plugin.recordSendFailure=()=>{};h.plugin.failRequest=async()=>{};
  let controls=0,mutations=0;const persisted:any[]=[];
  h.plugin.save=async()=>{persisted.push(structuredClone(h.plugin.settings.pending));};
  h.plugin.dispatch=async(request:any)=>{
    assert.equal(request.title,'Selected title');assert.ok(persisted.length);
    await sendDirect(request,undefined,h.plugin.save,undefined,{origin:'https://synthetic.example',api:async(path:string,payload?:unknown)=>{
      if(path.includes('/threads/')){controls++;return {thread:{...thread,hasPendingApprovals:race==='approval'}};}
      assert.equal(path,'/api/orchestration/dispatch');assert.ok(payload);
      assert.ok(persisted.some(items=>items[0]?.directPlan?.phase==='created'),'the exact plan is durable before mutation');
      mutations++;return {sequence:1};
    }});
  };
  h.plugin.prepareImages=async(markdown:string)=>{if(race==='stopped')h.plugin.stopped=true;return {markdown,attachments:[]};};
  const sending=h.plugin.sendChat('Question',undefined,{threadId:'t',preparation});
  if(race==='unchanged')await sending;else await assert.rejects(sending,race==='approval'?/approval/:/disabled/);
  assert.equal(controls,race==='stopped'?0:1);assert.equal(mutations,race==='unchanged'?1:0);assert.equal(h.plugin.busy,false);
});

for(const selected of [false,true])for(const ask of ['', 'Explain this.'])test(`unified composer routes ${selected?'selection':'note'} with ${ask?'an ask':'an empty ask'} and preserves its captured location`,async()=>{
 const h=await fixture(),calls:any[]=[],original=h.value(),options={version:1,inline:{enabled:false,intermediateMode:'collapse',finalAnswerFormat:'raw-markdown'},modelSelection:{instanceId:'p',model:'chosen'}};
 h.plugin.destinationContext=()=>({});h.plugin.withSendAvailability=(host:any)=>host;
 h.plugin.sendNote=async(...args:any[])=>{calls.push({kind:'note',args});};
 h.plugin.sendResolvedChat=async(...args:any[])=>{calls.push({kind:'chat',args});};
 h.plugin.recoverSmartReplies=async()=>{};h.plugin.smartData=()=>loadSmartSend(undefined);
 if(selected)h.select(0,'First paragraph.'.length);
 const host=h.plugin.noteComposerHost(h.file,selected?'First paragraph.':'',{view:h.view,editor:h.editor});
 if(selected){h.plugin.hasSmartContent=()=>assert.fail('An explicit selection must stay sendable when the note is unchanged');assert.equal(await host.hasNewContent({}),true);}
 h.cursor(original.length);
 const destination={threadId:'chosen-thread',projectKey:'project',label:'Chosen'};
 await host.sendChat(ask,'project',()=>options,undefined,destination);
 assert.equal(calls.length,1);
 if(!selected&&!ask){assert.equal(calls[0].kind,'note');assert.equal(calls[0].args[1],'chosen-thread');assert.equal(calls[0].args[5],options);}
 else{
  const [text,note,context,,route]=calls[0].args;assert.equal(calls[0].kind,'chat');assert.equal(note.path,h.file.path);assert.equal(route.threadId,'chosen-thread');assert.equal(route.jobOptions,options);
  if(selected){assert.equal(text,ask?`Selected text:\nFirst paragraph.\n\n**USER ASKS:**\n${ask}`:'First paragraph.');assert.ok(context.anchor);}
  else {assert.equal(text,ask);assert.ok(resolveCursorInsertion(original,context.insertion)<original.length);}
 }
});

for(const kind of ['mention','skill'])for(const target of ['new','existing'])test(`feedback with a ${kind} reference cannot fall through to ${target} thread delivery`,async()=>{
 const h=await fixture();h.plugin.destinationContext=()=>({});h.plugin.withSendAvailability=(host:any)=>host;
 h.plugin.openManualAction=()=>assert.fail('Feedback must not become an ordinary agent message');h.plugin.sendNote=()=>assert.fail('Feedback must not send the note');h.plugin.existingTarget=()=>assert.fail('Unsupported feedback references must be rejected before resolving or dispatching');h.plugin.inlineThreadAccess=()=>assert.fail('Unsupported references must not upload feedback');
 const context={version:1,records:[{version:1,contextId:'selected-context',kind,label:'Reference',path:kind==='mention'?'README.md':'/skills/review/SKILL.md',...(kind==='skill'?{name:'review'}:{})}]};
 const options={version:1,providerCommand:'feedback',modelSelection:{instanceId:'codex',model:'model'},context,inline:{enabled:true,intermediateMode:'collapse',finalAnswerFormat:'formatted'}};
 const host=h.plugin.noteComposerHost(h.file,'',{view:h.view,editor:h.editor});const prompt='/feedback Test report '+(kind==='mention'?'@README.md':'$review');
 await assert.rejects(target==='new'?host.sendToNew(prompt,'project',()=>options):host.sendChat(prompt,'project',()=>options,undefined,{threadId:'existing-thread',projectKey:'project',label:'Existing'}),target==='new'?/Start a Codex thread first/:/do not support file or skill references/);
 assert.equal(h.plugin.settings.pending,undefined);assert.equal(options.context.records.length,1);
});
