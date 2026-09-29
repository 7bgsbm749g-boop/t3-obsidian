import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {folderWorkflowIR} from '../v2-folder-workflow';
import {commandId} from '../direct';

async function folderMenuHarness(){
  const deviceId=randomUUID();let local:any={deviceId,mode:'direct',pairedSessions:{c:{url:'https://folder.example',environmentId:'env',token:'test',expiresAt:Date.now()+600000}}};
  const project={id:'project',title:'Writing',workspaceRoot:'/writing',connectionId:'c',connectionName:'Laptop'};
  const shared:any[]=[],modals:any[]=[],notices:string[]=[];
  let shownMenu:any,threadsReply:any[]|undefined;
  let fileMenu:(...args:any[])=>void=()=>{},failSave=false,networkRequests=0;
  class Element {
    text='';settings:any[]=[];children:Element[]=[];
    empty(){this.settings=[];this.children=[];}
    setText(value:string){this.text=value;}
    createEl(_tag:string,options?:{text?:string}){const child=new Element();child.text=options?.text??'';this.children.push(child);return child;}
  }
  class Control {
    value:any;disabled=false;text='';handler:(value?:any)=>any=()=>{};
    inputEl:any={rows:0};
    setValue(value:any){this.value=value;return this;}
    setPlaceholder(_value:string){return this;}
    addOptions(_value:Record<string,string>){return this;}
    setButtonText(text:string){this.text=text;return this;}
    setCta(){return this;}
    onChange(handler:(value:any)=>any){this.handler=handler;return this;}
    onClick(handler:()=>any){this.handler=handler;return this;}
    change(value:any){this.value=value;return this.handler(value);}
    async click(){if(!this.disabled)await this.handler();}
  }
  class Setting {
    name='';description='';disabled=false;controls:Control[]=[];
    constructor(element:Element){element.settings.push(this);}
    setName(name:string){this.name=name;return this;}
    setDesc(value:string){this.description=value;return this;}
    setDisabled(value:boolean){this.disabled=value;for(const control of this.controls)control.disabled=value;return this;}
    private add(callback:(control:Control)=>void){const control=new Control();this.controls.push(control);callback(control);return this;}
    addToggle(callback:(control:Control)=>void){return this.add(callback);}
    addText(callback:(control:Control)=>void){return this.add(callback);}
    addTextArea(callback:(control:Control)=>void){return this.add(callback);}
    addDropdown(callback:(control:Control)=>void){return this.add(callback);}
    addButton(callback:(control:Control)=>void){return this.add(callback);}
  }
  class Modal {
    contentEl=new Element();titleEl=new Element();closed=false;
    constructor(public app:any){}
    open(){modals.push(this);(this as any).onOpen?.();}
    close(){this.closed=true;}
    setPlaceholder(_value:string){return this;}
  }
  class Base {}
  class Folder {path='Notes';name='Notes';}
  class File {extension='md';constructor(public path:string){}}
  const folder=new Folder();
  class Plugin {
    app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>{local=value;},
      workspace:{onLayoutReady:()=>{},on:(name:string,callback:(...args:any[])=>void)=>{if(name==='file-menu')fileMenu=callback;}},
      vault:{getAbstractFileByPath:(path:string)=>path===folder.path?folder:undefined},
    };
    async loadData(){return {...(shared.at(-1)??{}),paired:[{id:'c',name:'Laptop',url:'https://folder.example',environmentId:'env'}],directScanId:'c',directProjects:[project],directSelected:['c:project']};}
    async saveData(data:any){if(failSave)throw Error('Simulated settings storage failure');shared.push(data);}
    addSettingTab(){}registerEvent(){}addCommand(){}
  }
  class MenuItem {
    title='';disabled=false;submenu?:Menu;callback:()=>any=()=>{};
    setTitle(title:string){this.title=title;return this;}
    setIcon(_icon:string){return this;}
    setDisabled(value:boolean){this.disabled=value;return this;}
    setSubmenu(){return this.submenu=new Menu();}
    onClick(callback:()=>any){this.callback=callback;return this;}
  }
  class Menu {
    items:MenuItem[]=[];
    addItem(callback:(item:MenuItem)=>void){const item=new MenuItem();this.items.push(item);callback(item);return this;}
    addSeparator(){return this;}
    showAtPosition(){shownMenu=this;return this;}
  }
  const api={Plugin,Menu,Platform:{isMobile:true},TFolder:Folder,TFile:File,Modal,FuzzySuggestModal:Modal,PluginSettingTab:Base,Setting,Notice:class{constructor(text:string){notices.push(text);}}};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{
    module,exports:module.exports,window:{innerWidth:1000,innerHeight:700},require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,
    document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    fetch:(url:string)=>{networkRequests++;if(threadsReply===undefined)throw Error('Link configuration must not dispatch or scan T3');return new Response(JSON.stringify(url.endsWith('/environment')?{environmentId:'env',label:'Laptop',orchestrationProtocolVersion:1}:{threads:threadsReply}));},
    Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const plugin=new module.exports.default();await plugin.onload();
  const open=async()=>{
    const menu=new Menu();fileMenu(menu,folder,'file-explorer-context-menu');
    const entry=menu.items.find(item=>item.title==='Link to T3 Code');assert.ok(entry?.submenu);
    const target=entry.submenu.items.find(item=>item.title==='Link to Writing · Laptop');assert.ok(target);
    await target.callback();return modals.at(-1);
  };
  const setting=(modal:Modal,name:string)=>{const item=modal.contentEl.settings.find(item=>item.name===name);assert.ok(item);return item as Setting;};
  const button=(modal:Modal,text:string)=>{const item=modal.contentEl.settings.flatMap(setting=>setting.controls).find(control=>control.text===text);assert.ok(item);return item as Control;};
  return {plugin,open,setting,button,shared,notices,deviceId,project,modals,shownMenu:()=>shownMenu,setThreads:(value:any[])=>{threadsReply=value;},folderMenu:(root=false)=>{const menu=new Menu();const selected=new Folder();if(root){selected.path='/';selected.name='QLO2';}fileMenu(menu,selected,'file-explorer-context-menu');return menu;},fileMenu:(path:string,mobile:boolean)=>{api.Platform.isMobile=mobile;const menu=new Menu();const file=new File(path);fileMenu(menu,file,'file-explorer-context-menu');return {menu,file};},networkRequests:()=>networkRequests,setFailSave:(value:boolean)=>{failSave=value;}};
}

test('folder menu opens an inactive link dialog; cancel is inert and Link alone persists',{timeout:5000},async()=>{
  const h=await folderMenuHarness();
  try{
    const saves=h.shared.length;
    const cancelled=await h.open();
    assert.equal(h.plugin.settings.folderLinks.length,0);
    assert.equal(h.shared.length,saves);
    await h.button(cancelled,'Cancel').click();
    assert.equal(cancelled.closed,true);assert.equal(h.shared.length,saves);
    const modal=await h.open();
    await h.button(modal,'Link').click();
    assert.equal(modal.closed,true);
    assert.equal(h.plugin.settings.folderLinks.length,1);
    assert.equal(h.shared.at(-1).folderLinks[0].tagTrigger,undefined);
    assert.equal(h.networkRequests(),0);
  }finally{h.plugin.onunload();}
});

test('v2 folder menu asks for a description and starts a setup thread',async()=>{
  const h=await folderMenuHarness();
  try{
    const link=await h.open();await h.button(link,'Link').click();
    const setups:any[]=[];
    h.plugin.setupV2Workflow=async(...args:any[])=>{setups.push(args);return 'setup-thread';};
    let entry=h.folderMenu().items.find((item:any)=>item.title==='Setup T3 workflow');assert.ok(entry?.submenu);
    assert.equal(entry!.submenu!.items.map((item:any)=>item.title).join(','),'Setup new workflow…');
    await entry!.submenu!.items[0].callback();let modal=h.modals.at(-1);
    assert.equal(modal.contentEl.settings.length,2);
    assert.ok(modal.contentEl.children.some((child:any)=>child.text==='Workflow folder: Notes'));
    h.setting(modal,'Description').controls[0].change('When I finish a note, format it.');
    await h.button(modal,'Create workflow').click();
    assert.equal(modal.closed,true);assert.equal(setups.length,1);
    assert.equal(setups[0][0].path,'Notes');assert.equal(setups[0][2],'When I finish a note, format it.');
    assert.ok(h.notices.some(text=>text.includes('setup-thread')));
  }finally{h.plugin.onunload();}
});

test('editing a workflow opens an empty change box and sends to the original setup thread',async()=>{
  const h=await folderMenuHarness();
  try{
    const linked=await h.open();await h.button(linked,'Link').click();
    const draft={...folderWorkflowIR({id:'workout',name:'Workout journal',folderPath:'Notes',includeSubfolders:true,events:['modify'],task:'Original workout instruction.',destinationId:'qlo2-vps',projectId:h.project.id,connectionId:'c',enabled:true,order:0}),setupIntent:'Original workout instruction.',setupRequestId:'02f7ea89-5b49-466a-b2a6-daa12a7402b3'};
    h.plugin.settings.automationDrafts=[draft];
    const calls:any[]=[];
    h.plugin.editV2Workflow=async(...args:any[])=>{calls.push(args);return commandId(draft.setupRequestId,'thread');};
    h.plugin.setupV2Workflow=async()=>{throw Error('Editing must not create a setup thread.');};
    const entry=h.folderMenu().items.find((item:any)=>item.title==='Setup T3 workflow');
    const existing=entry!.submenu!.items.find((item:any)=>item.title==='Workout journal');assert.ok(existing);
    await existing!.callback();const modal=h.modals.at(-1);
    assert.equal(h.setting(modal,'Change request').controls[0].value,'');
    assert.ok(!modal.contentEl.settings.some((item:any)=>item.name==='Description'));
    h.setting(modal,'Change request').controls[0].change('Only summarize weight increases.');
    await h.button(modal,'Save changes').click();
    assert.equal(calls.length,1);assert.equal(calls[0][2].workflowId,draft.workflowId);assert.equal(calls[0][3],'Only summarize weight increases.');
    assert.ok(h.notices.some(text=>text.includes(commandId(draft.setupRequestId,'thread'))));
  }finally{h.plugin.onunload();}
});

test('mobile root menu uses the recently pressed folder for workflow setup',async()=>{
  const h=await folderMenuHarness();
  try{
    const link=await h.open();await h.button(link,'Link').click();
    h.plugin.recentFolderGesture={path:'Notes',at:Date.now()};
    const entry=h.folderMenu(true).items.find((item:any)=>item.title==='Setup T3 workflow');assert.ok(entry?.submenu);
    await entry.submenu!.items.at(-1)!.callback();
    const modal=h.modals.at(-1);
    assert.ok(modal.contentEl.children.some((child:any)=>child.text==='Workflow folder: Notes'));
  }finally{h.plugin.onunload();}
});

test('an existing root-associated workflow can be attached to its selected folder without changing its scope',async()=>{
  const h=await folderMenuHarness();
  try{
    const linked=await h.open();await h.button(linked,'Link').click();
    const draft={...folderWorkflowIR({id:'workout',name:'Workout journal',folderPath:'/',includeSubfolders:true,events:['modify'],task:'Summarize workouts.',destinationId:'qlo2-vps',projectId:h.project.id,connectionId:'c',enabled:true,order:0}),scope:{path:{glob:'Notes/Tracker/*.md',case:'sensitive' as const},exclude:[],overlapPolicy:'all-matching' as const}};
    h.plugin.settings.automationDrafts=[draft];
    let moved:any;
    h.plugin.saveV2Workflow=async(ir:any)=>{moved=ir;h.plugin.settings.automationDrafts=[ir];};
    const entry=h.folderMenu().items.find((item:any)=>item.title==='Setup T3 workflow');assert.ok(entry?.submenu);
    const move=entry.submenu.items.find((item:any)=>item.title==='Move workflow here: Workout journal');assert.ok(move);
    await move.callback();
    assert.equal(moved.folderPath,'Notes');
    assert.equal(moved.scope.path.glob,'Notes/Tracker/*.md');
    assert.equal(moved.enabled,true);
    assert.equal(moved.revision,draft.revision+1);
  }finally{h.plugin.onunload();}
});

test('workflow creation saves an inert draft before sending its setup request',async()=>{
  const h=await folderMenuHarness();
  try{
    h.fileMenu('unused.md',false);
    const link=await h.open();await h.button(link,'Link').click();
    const linked=h.plugin.settings.folderLinks[0];
    h.plugin.settings.folderLinks.push({id:'root',folderPath:'/',vaultId:h.plugin.settings.vaultId,connectionId:'c',projectId:'root',projectTitle:'QLO2',workspaceRoot:'/vault',self:true});
    h.plugin.manifest={id:'send-to-t3-code'};
    h.plugin.projectForLink=()=>h.project;
    h.plugin.projectReadinessError=()=>undefined;
    h.plugin.connection=()=>({transport:'desktop',host:'local',executable:'t3'});
    const files=new Map<string,string>();let folderExists=false;
    h.plugin.app.vault.adapter={exists:async(path:string)=>path==='.obsidian/t3-code/setup'?folderExists:files.has(path),mkdir:async()=>{folderExists=true;},write:async(path:string,bytes:string)=>{files.set(path,bytes);},remove:async(path:string)=>{files.delete(path);}};
    let sent:any;
    h.plugin.dispatch=async(request:any)=>{sent=request;assert.equal(h.plugin.settings.automationDrafts[0].enabled,false);assert.equal(h.plugin.settings.pending[0].id,request.id);assert.equal(files.size,1);return 'setup-thread';};
    const thread=await h.plugin.setupV2Workflow({path:'Notes',name:'Notes'},linked,'When a note is tagged ready, summarize it.');
    assert.equal(thread,'setup-thread');
    const draft=h.plugin.settings.automationDrafts[0];
    assert.equal(draft.setupIntent,'When a note is tagged ready, summarize it.');
    assert.equal(draft.setupRequestId,sent.id);
    assert.equal(draft.activatedAt,undefined);
    assert.match(sent.prompt,/Workflow folder: Notes\nSetup instructions: \/vault\/\.obsidian\/t3-code\/setup\//);
    assert.doesNotMatch(sent.prompt,/disabled draft|Workflow ID|setupRequestId|eventTypes/);
    const setup=JSON.parse([...files.values()][0]);
    assert.equal(setup.draft.workflowId,draft.workflowId);
    assert.match(setup.instructions,/Use a direct trigger/);
  }finally{h.plugin.onunload();}
});

test('coordinator applies a matching setup proposal and removes its temporary file',async()=>{
  const h=await folderMenuHarness();
  try{
    const draft={...folderWorkflowIR({id:'setup',name:'Setup',folderPath:'Notes',includeSubfolders:true,events:['create'],task:'Summarize.',destinationId:'qlo2-vps',projectId:'project',connectionId:'c',enabled:false,order:0}),setupIntent:'When tagged ready, summarize.',setupRequestId:'request'};
    h.plugin.settings.automationDrafts=[draft];h.plugin.settings.automation.coordinatorDeviceId=h.deviceId;
    const path='.obsidian/t3-code/setup/setup-request.json';
    const configured={...draft,revision:2,enabled:true,trigger:{eventTypes:['note.changed'],unknown:'hold-for-review'}};
    const files=new Map([[path,JSON.stringify({workflowId:'setup',setupRequestId:'request',ir:configured})],['.obsidian/t3-code/setup/setup-request.request.json','setup context']]);
    h.plugin.app.vault.adapter={exists:async(p:string)=>p==='.obsidian/t3-code/setup'||files.has(p),list:async()=>({files:[...files.keys()],folders:[]}),read:async(p:string)=>files.get(p),remove:async(p:string)=>{files.delete(p);},rmdir:async()=>{}};
    await h.plugin.checkWorkflowProposals();
    assert.equal(files.size,0);
    assert.equal(h.plugin.settings.automationDrafts[0].enabled,true);
    assert.ok(h.plugin.settings.automationDrafts[0].activatedAt);
    assert.equal(h.plugin.settings.automationDrafts[0].trigger.eventTypes[0],'note.changed');
  }finally{h.plugin.onunload();}
});

test('workflow edits send a turn to the linked thread while the active revision stays in place until approval',async()=>{
  const h=await folderMenuHarness();
  try{
    h.fileMenu('unused.md',false);
    const linked=await h.open();await h.button(linked,'Link').click();
    const link=h.plugin.settings.folderLinks[0];
    h.plugin.settings.folderLinks.push({id:'root',folderPath:'/',vaultId:h.plugin.settings.vaultId,connectionId:'c',projectId:'root',projectTitle:'QLO2',workspaceRoot:'/vault',self:true});
    const workflowId='bd2e7b80-c408-4e67-81c6-007a83388272',setupRequestId='02f7ea89-5b49-466a-b2a6-daa12a7402b3';
    const draft={...folderWorkflowIR({id:workflowId,name:'Workout journal',folderPath:'Notes',includeSubfolders:true,events:['modify'],task:'Summarize workouts.',destinationId:'qlo2-vps',projectId:h.project.id,connectionId:'c',enabled:true,order:0}),revision:3,setupIntent:'Summarize workouts.',setupRequestId};
    h.plugin.settings.automationDrafts=[draft];h.plugin.settings.automation.coordinatorDeviceId=h.deviceId;
    h.plugin.projectForLink=()=>h.project;h.plugin.projectReadinessError=()=>undefined;
    h.plugin.connection=()=>({transport:'desktop',host:'local',executable:'t3'});
    h.plugin.verifyWorkflowSetupThread=async()=>{};
    const files=new Map<string,string>(),folders=new Set<string>();
    h.plugin.app.vault.adapter={exists:async(path:string)=>files.has(path)||folders.has(path),mkdir:async(path:string)=>{folders.add(path);},write:async(path:string,bytes:string)=>{files.set(path,bytes);},read:async(path:string)=>files.get(path),remove:async(path:string)=>{files.delete(path);},list:async(path:string)=>({files:[...files.keys()].filter(item=>item.startsWith(path+'/')),folders:[]}),rmdir:async()=>{}};
    let sent:any;
    h.plugin.dispatch=async(request:any)=>{sent=request;assert.equal(h.plugin.settings.automationDrafts[0].revision,3);assert.equal(h.plugin.settings.automationDrafts[0].enabled,true);return request.threadId;};
    const threadId=await h.plugin.editV2Workflow({path:'Notes',name:'Notes'},link,draft,'Only summarize weight increases.');
    assert.equal(threadId,commandId(setupRequestId,'thread'));
    assert.equal(sent.threadId,threadId);
    assert.equal(sent.prompt.split('Only summarize weight increases.').length-1,1);
    const pending=h.plugin.settings.workflowEditRequests[0];assert.equal(pending.workflowId,workflowId);
    const path=`.obsidian/t3-code/setup/${workflowId}-${pending.requestId}.json`,requestPath=path.replace(/\.json$/,'.request.json');
    assert.equal(JSON.parse(files.get(requestPath)!).current.revision,3);
    assert.equal(files.has(path),false);
    files.set(path,JSON.stringify({workflowId,editRequestId:pending.requestId,ir:{...draft,revision:4,setupRequestId:'other'}}));
    await h.plugin.checkWorkflowProposals();
    assert.equal(h.plugin.settings.automationDrafts[0].revision,3);
    assert.equal(h.plugin.settings.workflowEditRequests.length,1);
    files.set(path,JSON.stringify({workflowId,editRequestId:pending.requestId,ir:{...draft,revision:4,name:'Weight increases only'}}));
    h.plugin.saveV2Workflow=async(ir:any)=>{h.plugin.settings.automationDrafts=[ir];await h.plugin.save();};
    await h.plugin.checkWorkflowProposals();
    assert.equal(h.plugin.settings.automationDrafts[0].revision,4);
    assert.equal(h.plugin.settings.automationDrafts[0].setupRequestId,setupRequestId);
    assert.equal(h.plugin.settings.workflowEditRequests.length,0);
    assert.equal(files.has(path),false);assert.equal(files.has(requestPath),false);
  }finally{h.plugin.onunload();}
});

test('cancelling a workflow edit removes its local setup file and pending request',async()=>{
  const h=await folderMenuHarness();
  try{
    const workflowId=randomUUID(),requestId=randomUUID();
    const draft={...folderWorkflowIR({id:workflowId,name:'Workout journal',folderPath:'Notes',includeSubfolders:true,events:['modify'],task:'Summarize workouts.',destinationId:'qlo2-vps',projectId:'project',connectionId:'c',enabled:true,order:0}),setupRequestId:randomUUID()};
    const request={requestId,workflowId,baseRevision:draft.revision,requestedAt:new Date().toISOString()};
    h.plugin.settings.automationDrafts=[draft];h.plugin.settings.workflowEditRequests=[request];
    const path=`.obsidian/t3-code/setup/${workflowId}-${requestId}.request.json`;
    const files=new Map([[path,'edit context']]);
    h.plugin.app.vault.adapter={exists:async(p:string)=>files.has(p),remove:async(p:string)=>{files.delete(p);}};
    await h.plugin.cancelV2WorkflowEdit(draft);
    assert.equal(h.plugin.settings.workflowEditRequests.length,0);
    assert.equal(files.size,0);
    assert.equal(h.plugin.settings.automationDrafts[0].revision,draft.revision);
  }finally{h.plugin.onunload();}
});

test('coordinator consumes remote workflow edit cancellation markers',async()=>{
  const h=await folderMenuHarness();
  try{
    const workflowId=randomUUID(),requestId=randomUUID();
    h.plugin.settings.automation.coordinatorDeviceId=h.deviceId;
    h.plugin.settings.workflowEditRequests=[{requestId,workflowId,baseRevision:3,requestedAt:new Date().toISOString()}];
    const base=`.obsidian/t3-code/setup/${workflowId}-${requestId}`;
    const files=new Map([[`${base}.request.json`,JSON.stringify({schemaVersion:1,kind:'workflow.edit.cancelled',workflowId,editRequestId:requestId})],[`${base}.json`,'stale proposal']]);
    h.plugin.app.vault.adapter={exists:async(p:string)=>p==='.obsidian/t3-code/setup'||files.has(p),list:async()=>({files:[...files.keys()],folders:[]}),read:async(p:string)=>files.get(p),remove:async(p:string)=>{files.delete(p);},rmdir:async()=>{}};
    await h.plugin.checkWorkflowProposals();
    assert.equal(h.plugin.settings.workflowEditRequests.length,0);
    assert.equal(files.size,0);
  }finally{h.plugin.onunload();}
});

for(const mobile of [false,true])test(`linked note menu offers new and existing threads on ${mobile?'mobile':'desktop'}`,async()=>{
  const h=await folderMenuHarness();
  try{
    const nested={...h.project,id:'nested',title:'Nested'};
    h.plugin.settings.directProjects.push(nested);
    h.plugin.settings.directSelected=[];
    h.plugin.settings.folderLinks=[{id:'parent',folderPath:'Notes',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot,connectionId:'c',self:false},
      {id:'inner',folderPath:'Notes/Inner',projectId:nested.id,projectTitle:nested.title,workspaceRoot:nested.workspaceRoot,connectionId:'c',self:false}];
    h.plugin.chatReadinessError=()=>undefined;
    const sent:any[]=[];h.plugin.send=async(file:any,project:any,options:any)=>{sent.push({file,project,options});};
    const {menu,file}=h.fileMenu('Notes/Inner/note.md',mobile);
    const item=menu.items.find(item=>item.title==='Open in T3 Code');assert.ok(item);
    if(mobile)await item.callback();
    const choices=mobile?h.modals.at(-1):item.submenu;assert.ok(choices);
    if(mobile){
      assert.equal(choices.constructor.name,'LinkedNoteDestinationModal');
      assert.equal(choices.titleEl.text,'Send to T3 Code');
      assert.deepEqual(choices.contentEl.settings.flatMap((setting:any)=>setting.controls.map((control:any)=>control.text)),['New thread','Existing thread…']);
      await h.button(choices,'New thread').click();
    }else{
      assert.deepEqual(choices.items.map((i:any)=>i.title),['Send to new thread','Send to existing thread…']);
      await choices.items[0].callback();
    }
    assert.equal(sent.length,1);assert.equal(sent[0].file,file);assert.equal(sent[0].project.id,'nested');assert.equal(sent[0].options.threadId,undefined);
    h.plugin.settings.noteThreads.push({notePath:'Notes/Inner/note.md',threadId:'previous-parent-thread',projectId:h.project.id,workspaceRoot:h.project.workspaceRoot,connectionId:'c',selectedAt:'2026-09-28T00:00:00Z'});
    h.setThreads([{id:'thread',projectId:'nested',title:'Existing',updatedAt:'2026-09-19',session:{status:'running',activeTurnId:'turn'},latestTurn:{state:'running'}},
      {id:'foreign',projectId:h.project.id,title:'Wrong project',updatedAt:'2026-09-20'},
      {id:'archived',projectId:'nested',title:'Archived',archivedAt:'2026-09-19'}]);
    if(mobile){h.plugin.openLinkedNote(file);await h.button(h.modals.at(-1),'Existing thread…').click();}
    else await choices.items[1].callback();
    const picker=h.modals.at(-1);assert.equal(picker.getItems().length,1);
    assert.equal(picker.getItems()[0].id,'thread');
    assert.match(picker.getItemText(picker.getItems()[0]),/Existing · Active/);
    picker.onChooseItem(picker.getItems()[0]);
    assert.equal(sent.length,2);assert.equal(sent[1].options.threadId,'thread');assert.equal(sent[1].project.id,'nested');
    h.plugin.settings.folderLinks[1].projectId=h.project.id;
    picker.onChooseItem(picker.getItems()[0]);
    assert.equal(sent.length,2,'Changing the link while choosing a thread must not send to a stale target');
    assert.match(h.notices.at(-1)!,/linked project changed/i);
  }finally{h.plugin.onunload();}
});

test('unlinked notes retain project choices and root links cover root-level notes',async()=>{
  const h=await folderMenuHarness();
  try{
    const unlinked=h.fileMenu('Unlinked/note.md',false).menu.items[0].submenu;
    assert.ok(unlinked?.items.some(item=>item.title==='New thread in Writing · Laptop'));
    h.plugin.settings.folderLinks=[{id:'root',folderPath:'/',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot,connectionId:'c',self:false}];
    const submenu=h.fileMenu('note.md',false).menu.items[0].submenu;assert.ok(submenu);
    assert.equal(submenu.items[0].title,'Send to new thread');
    h.plugin.busy=true;
    assert.ok(h.fileMenu('note.md',false).menu.items[0].submenu?.items.every(item=>item.disabled));
  }finally{h.plugin.onunload();}
});
