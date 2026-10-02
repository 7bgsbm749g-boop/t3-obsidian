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
  const api={Platform:{isMobile:false},TFolder:Folder,TFile:Base,MarkdownView:Base,Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:Base,
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
    WebSocket:settingsSocket(),Headers,Response,AbortController,URL,URLSearchParams,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,console,
  },{timeout:5000});
  const start=async()=>{const plugin=new module.exports.default();await plugin.onload();return plugin;};
  const plugin=await start();
  return {plugin,start,shared,commands,project,vaultRoot,root,
    addFolder:async(path:string)=>{const folder=new Folder();folder.path=path;folder.name=path.split('/').at(-1)!;folders.set(path,folder);await mkdir(join(vaultRoot,path),{recursive:true});},
    setNote:(path?:string)=>{activeFile=path?{path,extension:'md'}:undefined;},
    cliCalls:async()=> (await readFile(callsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),
    dispose:async()=>{plugin.onunload();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});},
  };
}

for(const existing of [false,true])test(`desktop chat ${existing?'reuses':'creates'} the vault-root project and persists its link`,{timeout:20_000},async()=>{
  const h=await harness(existing);
  try{
    h.setNote('draft.md');await h.plugin.sendChat('Edit this note',{path:'draft.md',absolutePath:join(h.vaultRoot,'draft.md')});
    assert.equal(h.commands[0].projectId,h.project.id);
    assert.equal(h.commands[0].title,'Edit this note');
    assert.match(h.commands[1].message.text,/draft.md/);
    assert.ok(h.commands[1].message.text.includes(JSON.stringify(join(h.vaultRoot,'draft.md'))));
    assert.equal(h.commands[1].message.attachments.length,0);
    assert.equal(h.shared.at(-1).folderLinks[0].folderPath,'/');
    assert.equal(h.shared.at(-1).folderLinks[0].workspaceRoot,h.vaultRoot);
    assert.equal(h.shared.at(-1).folderLinks[0].tagTrigger,undefined);
    const additions=(await h.cliCalls()).filter(args=>args[0]==='project');
    assert.equal(additions.length,existing?0:1);
    if(!existing)assert.equal(additions[0].at(-1),h.vaultRoot);
    h.plugin.onunload();const restarted=await h.start();
    h.setNote();await restarted.sendChat('Work in the vault');
    assert.equal(h.commands[2].projectId,h.project.id);
    assert.ok(h.commands[3].message.text.startsWith('Work in the vault'));
    assert.doesNotMatch(h.commands[3].message.text,/T3 EVENT HISTORY CAPABILITY/);
    assert.equal((await h.cliCalls()).filter(args=>args[0]==='project').length,existing?0:1);
    assert.equal(restarted.settings.completionJobs.length,0);
    restarted.onunload();
  }finally{await h.dispose();}
});

test('desktop root fallback works while the user has T3 Connect mode selected',{timeout:20_000},async()=>{
  const h=await harness(false,'direct');
  try{
    await h.plugin.sendChat('Use the vault');
    assert.equal(h.commands.length,2);assert.equal(h.commands[0].projectId,h.project.id);
    assert.equal(h.plugin.mode,'direct','Automatic local routing must preserve the selected connection mode');
  }finally{await h.dispose();}
});


test('desktop unlinked notes choose an external workspace and persist the link only after delivery',{timeout:20_000},async()=>{
  const h=await harness(true);
  try{
    await h.addFolder('Fresh/deep');
    const external=join(h.vaultRoot,'..','External project');await mkdir(external);
    h.plugin.pickFolderProject=async(_folder:any,name:string)=>{const location=await h.plugin.projectLocation({id:'local',name:'This computer',local:true});return location.create(external,name);};
    await h.plugin.sendChat('Reply only OK',{path:'Fresh/deep/note.md',absolutePath:join(h.vaultRoot,'Fresh/deep/note.md')});
    const link=h.plugin.settings.folderLinks.find((link:any)=>link.folderPath==='Fresh/deep');
    assert.equal(link.projectTitle,'deep');assert.equal(link.self,false);
    assert.equal(link.workspaceRoot,external);
    assert.equal(h.commands[0].projectId,link.projectId);
    await h.plugin.sendChat('Another note',{path:'Fresh/deep/child/note.md',absolutePath:join(h.vaultRoot,'Fresh/deep/child/note.md')},{newThread:true});
    assert.equal(h.commands[2].projectId,link.projectId);
    assert.equal((await h.cliCalls()).filter(args=>args[0]==='project').length,1);
  }finally{await h.dispose();}
});
