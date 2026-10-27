import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {settingsSocket} from './rpc-fixture';

const realRequire=createRequire(import.meta.url);
async function harness(existing:boolean,mode:'desktop'|'direct'='desktop'){
  const dir=await mkdtemp(join(tmpdir(),'obsidian-root-chat-'));
  const vaultRoot=join(dir,'Vault café with spaces'),catalogPath=join(dir,'catalog.json'),callsPath=join(dir,'cli.jsonl');
  const project={id:randomUUID(),title:'Existing vault',workspaceRoot:vaultRoot};
  const noProject={id:randomUUID(),title:'No project',workspaceRoot:join(dir,'scratch')};
  await mkdir(join(dir,'userdata'));await mkdir(vaultRoot);
  await writeFile(catalogPath,JSON.stringify(existing?[project]:[]));
  const cliPath=join(dir,'fake-t3.cjs');
  await writeFile(cliPath,`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify(args)+'\\n');
if(args[0]==='auth'){
 if(args[2]==='issue')console.log(JSON.stringify({token:'test-only',sessionId:'test-session'}));
}else if(args[0]==='project'&&args[1]==='add'){
 const projects=JSON.parse(fs.readFileSync(${JSON.stringify(catalogPath)},'utf8'));
 const project={id:args.at(-1)===${JSON.stringify(vaultRoot)}?${JSON.stringify(project.id)}:require('node:crypto').randomUUID(),title:args[args.indexOf('--title')+1],workspaceRoot:args.at(-1)};
 projects.push(project);fs.writeFileSync(${JSON.stringify(catalogPath)},JSON.stringify(projects));
 console.log('Added project '+project.id);
}else process.exitCode=1;
`,{mode:0o700});
  const commands:any[]=[],shared:any[]=[];
  const server=createServer(async(req,res)=>{
    try{
      if(req.url==='/.well-known/t3/environment'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({environmentId:'test-environment',orchestrationProtocolVersion:2}));return;}
      assert.equal(req.headers.authorization,'Bearer test-only');
      res.setHeader('Content-Type','application/json');
      if(req.url?.endsWith('/shell')){
        const projects=JSON.parse(await readFile(catalogPath,'utf8')).map((p:any)=>({...p,defaultModelSelection:{instanceId:'codex',model:'test'}}));
        res.end(JSON.stringify({projects,threads:[]}));
      }else if(req.url?.endsWith('/websocket-ticket'))res.end(JSON.stringify({ticket:'ephemeral'}));
      else{
        let body='';for await(const chunk of req)body+=chunk;
        commands.push(JSON.parse(body));res.end('{}');
      }
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  await writeFile(join(dir,'userdata','server-runtime.json'),JSON.stringify({origin:`http://127.0.0.1:${(server.address() as any).port}`}));
  const connection={native:true,executable:cliPath,host:'local',baseDir:dir};
  let local:any={deviceId:randomUUID(),mode,connection},activeFile:any;
  class Base{}
  class Folder {path='/';name='';}
  const root=new Folder();
  const folders=new Map<string,Folder>();
  const api={Platform:{isMobile:false},TFolder:Folder,TFile:Base,MarkdownView:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,
    Plugin:class {
      app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>{local=value;},
        workspace:{onLayoutReady:()=>{},on:()=>{},getActiveViewOfType:()=>activeFile?{file:activeFile}:undefined},
        vault:{getAbstractFileByPath:(path:string)=>folders.get(path),getRoot:()=>root,getName:()=> 'Vault café with spaces',adapter:{getFullPath:(path:string)=>join(vaultRoot,path)},
          read:()=>assert.fail('Chat must not read Markdown'),readBinary:()=>assert.fail('Chat must not read images')},
      };
      async loadData(){return shared.at(-1)??{};}
      async saveData(value:any){shared.push(value);}
      addCommand(){} addSettingTab(){} registerEvent(){}
    },
  };
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,
    require:(name:string)=>name==='obsidian'?api:realRequire(name),indexedDB,
    global:{},process,Buffer,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    WebSocket:settingsSocket(undefined,undefined,async(tag,payload)=>{
      if(tag==='projects.ensureScratch'){const projects=JSON.parse(await readFile(catalogPath,'utf8'));if(!projects.some((p:any)=>p.id===noProject.id))await writeFile(catalogPath,JSON.stringify([...projects,noProject]));return {projectId:noProject.id};}
      assert.equal(tag,'orchestration.dispatchCommand');commands.push(payload);return {};
    }),Headers,Response,AbortController,URL,URLSearchParams,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,console,
  },{timeout:5000});
  const start=async()=>{const plugin=new module.exports.default();await plugin.onload();return plugin;};
  const plugin=await start();
  return {plugin,start,shared,commands,project,noProject,vaultRoot,root,
    addFolder:async(path:string)=>{const folder=new Folder();folder.path=path;folder.name=path.split('/').at(-1)!;folders.set(path,folder);await mkdir(join(vaultRoot,path),{recursive:true});},
    setNote:(path?:string)=>{activeFile=path?{path,extension:'md'}:undefined;},
    cliCalls:async()=> (await readFile(callsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),
    dispose:async()=>{plugin.onunload();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});},
  };
}

for(const existing of [false,true])test(`desktop chat uses No project with ${existing?'an existing':'no'} vault project without creating a root link`,{timeout:20_000},async()=>{
  const h=await harness(existing);
  try{
    h.setNote('draft.md');await h.plugin.sendChat('Edit this note',{path:'draft.md',absolutePath:join(h.vaultRoot,'draft.md')});
    assert.equal(h.commands[0].projectId,h.noProject.id);
    assert.equal(h.commands[0].title,'draft');
    assert.match(h.commands[1].text,/draft.md/);
    assert.equal(h.commands[1].text,'Edit this note\n\nSent from Obsidian.\nVault: Vault café with spaces\nNote: draft.md');
    assert.equal(h.commands[1].attachments.length,0);
    assert.equal(h.shared.at(-1).folderLinks.length,0);
    const additions=(await h.cliCalls()).filter(args=>args[0]==='project');
    assert.equal(additions.length,0);
    h.plugin.onunload();const restarted=await h.start();
    h.setNote();await restarted.sendChat('Work in the vault');
    assert.equal(h.commands[2].projectId,h.noProject.id);
    assert.ok(h.commands[3].text.startsWith('Work in the vault'));
    assert.doesNotMatch(h.commands[3].text,/T3 EVENT HISTORY CAPABILITY/);
    assert.equal((await h.cliCalls()).filter(args=>args[0]==='project').length,0);
    assert.equal(restarted.settings.completionJobs.length,0);
    restarted.onunload();
  }finally{await h.dispose();}
});

test('desktop root fallback works while the user has T3 Connect mode selected',{timeout:20_000},async()=>{
  const h=await harness(false,'direct');
  try{
    await h.plugin.sendChat('Use the vault');
    assert.equal(h.commands.length,2);assert.equal(h.commands[0].projectId,h.noProject.id);
    assert.equal(h.plugin.mode,'direct','Automatic local routing must preserve the selected connection mode');
  }finally{await h.dispose();}
});


test('desktop unlinked notes choose an external workspace and persist the link only after delivery',{timeout:20_000},async()=>{
  const h=await harness(true);
  try{
    await h.addFolder('Fresh/deep');
    const external=join(h.vaultRoot,'..','External project');await mkdir(external);
    h.plugin.pickFolderProject=async(_folder:any,name:string)=>{const location=await h.plugin.projectLocation({id:'local',name:'This computer',local:true});return location.create(external,name);};
    await h.plugin.sendChat('Reply only OK',{path:'Fresh/deep/note.md',absolutePath:join(h.vaultRoot,'Fresh/deep/note.md')},{projectOverrideKey:'folder:new'});
    const link=h.plugin.settings.folderLinks.find((link:any)=>link.folderPath==='Fresh/deep');
    assert.equal(link.projectTitle,'deep');assert.equal(link.self,false);
    assert.equal(link.workspaceRoot,external);
    assert.equal(h.commands[0].projectId,link.projectId);
    await h.plugin.sendChat('Another note',{path:'Fresh/deep/child/note.md',absolutePath:join(h.vaultRoot,'Fresh/deep/child/note.md')},{newThread:true});
    assert.equal(h.commands[2].projectId,link.projectId);
    assert.equal((await h.cliCalls()).filter(args=>args[0]==='project').length,1);
  }finally{await h.dispose();}
});

test('desktop new workspace creation checks vault exclusion before making a directory',{timeout:20_000},async()=>{
  const h=await harness(true);
  try{
    const parent=join(h.vaultRoot,'..'),root=join(parent,'New workspace');
    const location=await h.plugin.projectLocation({id:'local',name:'This computer',local:true});
    const project=await location.create(root,'Created workspace',{parentPath:parent,name:'New workspace'});
    assert.equal(project.workspaceRoot,root);
    assert.equal((await location.browse(root)).parentPath,root);
    const retry=await location.create(root,'Created workspace',{parentPath:parent,name:'New workspace'});
    assert.equal(retry.id,project.id);assert.equal((await h.cliCalls()).filter(args=>args[0]==='project').length,1);
    const blocked=join(h.vaultRoot,'blocked');
    await assert.rejects(location.create(blocked,'Blocked',{parentPath:h.vaultRoot,name:'blocked'}),/outside the Obsidian vault/);
    assert.ok(!(await location.browse(h.vaultRoot)).entries.some((entry:any)=>entry.name==='blocked'));
  }finally{await h.dispose();}
});


test('send context remains available after removal of the wait feature',{timeout:20_000},async()=>{
  const h=await harness(true);
  try{
    h.setNote('draft.md');await h.plugin.sendChat('Use the requested plan',{path:'draft.md'});
    const sent=h.commands[1];
    assert.equal(sent.text,'Use the requested plan\n\nSent from Obsidian.\nVault: Vault café with spaces\nNote: draft.md');
    const record=h.shared.at(-1).noteContexts[0];
    assert.equal(record.waitForOtherThreads,undefined);assert.equal(record.notePath,'draft.md');
    const saves=h.shared.length;
    const result=await h.plugin.executeAgentCommand({version:1,id:randomUUID(),kind:'note-context',notePath:'draft.md',threadId:record.threadId,messageId:record.messageId});
    assert.equal(result.context.send.messageId,record.messageId);assert.equal(result.context.send.waitForOtherThreads,undefined);assert.equal(result.context.destinations.length,0);
    assert.equal(h.shared.length,saves,'Context inspection must not save settings or notes');
    h.plugin.onunload();const restarted=await h.start();
    const recovered=await restarted.executeAgentCommand({version:1,id:randomUUID(),kind:'note-context',messageId:record.messageId});
    assert.equal(recovered.context.send.notePath,'draft.md');restarted.onunload();
  }finally{await h.dispose();}
});


test('send context includes fresh bindings, steering destinations, and a continued response',{timeout:20_000},async()=>{
  const h=await harness(true);
  try{
    const ids=Array.from({length:4},()=>randomUUID());
    await h.plugin.captureNoteContext({id:randomUUID(),prompt:'Continue this task',project:h.project,connection:{environmentId:'test-environment'},noteThread:{notePath:'draft.md'},inlineBindings:[{id:ids[0]}],inlineSteering:{jobId:ids[1],targets:[{jobId:ids[1]},{jobId:ids[2]}]},inlineFollow:{jobId:ids[3]}});
    assert.deepEqual(Array.from(h.shared.at(-1).noteContexts[0].bindingIds),ids);
  }finally{await h.dispose();}
});

test('unlinked subfolder sends use No project without opening the workspace picker',{timeout:20_000},async()=>{
  const h=await harness(false);
  try{
    await h.addFolder('Unlinked');h.plugin.pickFolderProject=()=>assert.fail('No automatic project picker');
    await h.plugin.sendChat('Read this note',{path:'Unlinked/Note.md'});
    assert.equal(h.commands[0].projectId,h.noProject.id);
    assert.equal(h.shared.at(-1).folderLinks.length,0);
    const host=await h.plugin.localResponseTarget({project:h.noProject,connection:{environmentId:'test-environment'}});
    assert.equal(host.workspaceRoot,h.vaultRoot);assert.notEqual(host.workspaceRoot,h.noProject.workspaceRoot);
  }finally{await h.dispose();}
});

test('old vault conversations remain selectable while new notes ignore the legacy root project',{timeout:20_000},async()=>{
  const h=await harness(true);
  try{
    const link={id:'old-root',folderPath:'/',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.vaultRoot,connectionId:'',self:true};
    const remembered={notePath:'Old.md',projectId:h.project.id,workspaceRoot:h.vaultRoot,connectionId:'',threadId:randomUUID(),selectedAt:new Date().toISOString()};
    h.plugin.settings.folderLinks=[link];h.plugin.settings.projects=[h.project];h.plugin.settings.noteThreads=[remembered];
    const before=JSON.stringify({links:h.plugin.settings.folderLinks,threads:h.plugin.settings.noteThreads});
    assert.equal((await h.plugin.chatTarget('Old.md')).project.id,h.project.id);
    assert.equal((await h.plugin.chatTarget('Fresh.md')).project.id,h.noProject.id);
    assert.equal(JSON.stringify({links:h.plugin.settings.folderLinks,threads:h.plugin.settings.noteThreads}),before);
  }finally{await h.dispose();}
});

test('a saved local connection resolves to its original remote machine on a different desktop',{timeout:20_000},async()=>{
  const h=await harness(true);
  try{
    h.plugin.eventLocalEnvironmentId='test-environment';
    h.plugin.settings.paired=[{id:'original',name:'Original computer',environmentId:'other-environment',url:'https://original.example'}];
    h.plugin.settings.vaultHost={connectionId:'',environmentId:'other-environment',workspaceRoot:h.vaultRoot};
    assert.equal(h.plugin.defaultNoProjectMachine(),'original');
    h.plugin.settings.vaultHost.environmentId='test-environment';
    assert.equal(h.plugin.defaultNoProjectMachine(),'local');
  }finally{await h.dispose();}
});
