import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {executeFolderCommand,inspectFolderLinks,validateFolderCommand,type FolderCommand,type FolderCommandHost,type FolderCommandJournal} from '../folder-command';
import {upsertFolderLink,type FolderLink} from '../folder-link';
import {validateAgentCommand} from '../note-command';

const project={id:'project',title:'Verified repository',workspaceRoot:'/repo',connectionId:'connection'};
const link=(folderPath:string,id=folderPath):FolderLink=>({id,folderPath,connectionId:'connection',projectId:'project',projectTitle:'Verified repository',workspaceRoot:'/repo',self:false});
const command=(folderPath='Notes',extra:any={}):Extract<FolderCommand,{kind:'link-folder'}>=>({version:1,id:randomUUID(),kind:'link-folder',folderPath,projectId:'project',connectionId:'connection',environmentId:'environment',mode:'project',relink:false,...extra});
function harness(initial:FolderLink[]=[]){
  let links=initial,saves=0,resolutions=0,failSave=false,failAck=false,unavailable=false;
  const journals=new Map<string,FolderCommandJournal>();
  const host:FolderCommandHost={vaultId:'vault',links:()=>links,validateFolder:path=>{if(path==='Missing')throw Error('Folder not found');},refresh:async()=>{},
    resolve:async()=>{resolutions++;if(unavailable)throw Error('Unavailable');return project;},
    read:async id=>journals.get(id),write:async(id,journal)=>{if(failAck&&journal.result){failAck=false;throw Error('Lost acknowledgement');}journals.set(id,structuredClone(journal));},
    save:async after=>{saves++;if(failSave)throw Error('Save failed');links=upsertFolderLink(links,after);},
    unlink:async path=>{saves++;if(failSave)throw Error('Save failed');links=links.filter(link=>link.folderPath!==path);},
  };
  return {host,journals,links:()=>links,saves:()=>saves,resolutions:()=>resolutions,setLinks:(value:FolderLink[])=>{links=value;},failSave:(value:boolean)=>{failSave=value;},failAck:()=>{failAck=true;},unavailable:()=>{unavailable=true;}};
}
test('link commands save file destinations and subsequent project relinks preserve them',async()=>{
  const h=harness(),folders={images:'Pictures/T3',files:'Documents/T3'};
  await executeFolderCommand(command('Notes',{replyFolders:folders}),h.host);
  assert.deepEqual(h.links()[0].replyFolders,folders);
  await executeFolderCommand(command('Notes'),h.host);assert.deepEqual(h.links()[0].replyFolders,folders);
  assert.throws(()=>validateFolderCommand(command('Notes',{replyFolders:{images:'../Escape',files:'Files'}})),/folder/i);
  assert.throws(()=>validateFolderCommand(command('/',{mode:'self',replyFolders:folders})),/general settings/);
});
test('strict agent folder paths and explicit identities reject unsafe or ambiguous input',()=>{
  for(const path of ['','..','Notes/../Secret','/Notes','Notes/','Notes//A','.obsidian','Notes/.hidden','C:\\vault','Notes\\A','Notes\nA','Notes\x7fA',' Notes'])assert.throws(()=>validateAgentCommand(command(path)));
  for(const path of ['/','Notes','Projects/Side/handoff'])assert.equal(validateFolderCommand(command(path,{mode:path==='/'?'self':'project'})).folderPath,path);
  for(const extra of [{projectId:''},{connectionId:''},{environmentId:''},{mode:'create'},{relink:undefined},{projectTitle:'Forged'},{kind:'unlink-folder',projectId:'project'}])assert.throws(()=>validateAgentCommand(command('Notes',extra)));
  assert.throws(()=>validateFolderCommand(command('/')),/root requires self/);
});
test('inspection reports direct and nearest inherited links and root-only automatic project routing',()=>{
  const links=[link('/'),link('Notes'),link('Notes/Inner')];
  const result=inspectFolderLinks('request','vault','Notes/Inner/Child',links);
  assert.equal(result.directLink,null);assert.equal(result.effectiveLink?.folderPath,'Notes/Inner');assert.equal(result.routing,'linked-project');
  const rootOnly=inspectFolderLinks('request','vault','Other',[links[0]]);assert.equal(rootOnly.effectiveLink?.folderPath,'/');assert.equal(rootOnly.routing,'new-folder-project');
  assert.equal(inspectFolderLinks('r','v','/',[]).routing,'vault-project-setup');
});
test('commands link, require deliberate relinking, preserve nested links, and unlink to inheritance',async()=>{
  const h=harness([link('Notes/Inner')]);const request=command();
  const result=await executeFolderCommand(request,h.host);assert.equal(result.directLink?.projectTitle,project.title);assert.equal(result.effectiveLink?.environmentId,'environment');assert.equal(h.links().length,2);
  assert.deepEqual(await executeFolderCommand(request,h.host),result);assert.equal(h.saves(),1);assert.equal(h.resolutions(),1);
  await assert.rejects(executeFolderCommand({...request,mode:'self'},h.host),/different input/);
  h.setLinks([link('Notes/Inner'),{...link('Notes'),projectId:'old',workspaceRoot:'/old'}]);
  await assert.rejects(executeFolderCommand(command(),h.host),/--relink/);assert.equal(h.links()[1].projectId,'old');
  await executeFolderCommand(command('Notes',{relink:true}),h.host);assert.equal(h.links()[1].projectId,'project');
  const unlink:FolderCommand={version:1,id:randomUUID(),kind:'unlink-folder',folderPath:'Notes/Inner'};
  const unlinked=await executeFolderCommand(unlink,h.host);assert.equal(unlinked.directLink,null);assert.equal(unlinked.effectiveLink?.folderPath,'Notes');assert.equal(h.links().length,1);
  h.setLinks([link('Notes/Inner'),...h.links()]);await executeFolderCommand(unlink,h.host);assert.equal(h.links().length,2,'old acknowledgement cannot remove a later link');
});
test('unavailable, missing, failed saves and conflicting prepared retries preserve the old link',async()=>{
  const old={...link('Notes'),projectId:'old'},h=harness([old]);
  h.unavailable();await assert.rejects(executeFolderCommand(command('Notes',{relink:true}),h.host),/Unavailable/);assert.deepEqual(h.links(),[old]);assert.equal(h.saves(),0);
  await assert.rejects(executeFolderCommand(command('Missing'),h.host),/Folder not found/);assert.equal(h.resolutions(),1);
  const storage=harness([old]);storage.failSave(true);const request=command('Notes',{relink:true});
  await assert.rejects(executeFolderCommand(request,storage.host),/Save failed/);assert.deepEqual(storage.links(),[old]);
  storage.setLinks([link('Notes','intervening')]);storage.failSave(false);
  await assert.rejects(executeFolderCommand(request,storage.host),/changed since/);assert.equal(storage.links()[0].id,'intervening');
});
test('lost acknowledgement recovers the exact saved result without revalidating or saving',async()=>{
  const h=harness();h.failAck();const request=command();await assert.rejects(executeFolderCommand(request,h.host),/Lost acknowledgement/);
  const saved=h.links()[0];h.unavailable();const result=await executeFolderCommand(request,h.host);
  assert.deepEqual(result.directLink,saved);assert.equal(h.resolutions(),1);assert.equal(h.saves(),1);
});
test('a concurrent newer edit cannot receive a false successful acknowledgement',async()=>{
  const h=harness(),newer=link('Notes','newer');
  h.host.save=async()=>{h.setLinks([newer]);};
  await assert.rejects(executeFolderCommand(command(),h.host),/newer folder edit/);
  assert.equal(h.links()[0].id,'newer');
});
test('inspection and unlinking are independent of T3 connectivity; inspections replay immutable snapshots',async()=>{
  const h=harness([link('Notes')]);h.unavailable();
  const inspect:FolderCommand={version:1,id:randomUUID(),kind:'inspect-folder',folderPath:'Notes/Child'};
  const result=await executeFolderCommand(inspect,h.host);h.setLinks([]);
  assert.deepEqual(await executeFolderCommand(inspect,h.host),result);assert.equal(h.saves(),0);assert.equal(h.resolutions(),0);
  const unlink:FolderCommand={version:1,id:randomUUID(),kind:'unlink-folder',folderPath:'Notes'};
  assert.equal((await executeFolderCommand(unlink,h.host)).effectiveLink,null);assert.equal(h.resolutions(),0);
});
