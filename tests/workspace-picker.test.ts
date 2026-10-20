import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {workspaceChildPath,workspaceParentPath,projectCreationDefaults,rememberProjectCreationLocation,loadProjectCreationLocations} from '../workspace-picker';
import {createDesktopFolder} from '../desktop';

test('workspace folder names stay within their parent on Linux and Windows',()=>{
  assert.equal(workspaceChildPath('/work','Café project'),'/work/Café project');
  assert.equal(workspaceChildPath('/','project'),'/project');
  assert.equal(workspaceChildPath('C:\\Work\\','project'),'C:\\Work\\project');
  for(const name of ['','..','../escape','child/leaf','child\\leaf','NUL','com1.txt','tail.','new\nfolder'])assert.throws(()=>workspaceChildPath('/work',name));
});

test('workspace parents preserve POSIX, Windows drive and network roots',()=>{
  for(const [path,parent] of [['/work/app/','/work'],['/app','/'],['/','/'],['C:\\Projects\\app','C:\\Projects'],['C:\\app','C:\\'],['C:\\','C:\\'],['\\\\server\\share\\app','\\\\server\\share'],['\\\\server\\share','\\\\server\\share']])assert.equal(workspaceParentPath(path),parent);
});

test('saved defaults select the most recent machine, restore per-machine folders and survive connection aliases',()=>{
  const machines=[{id:'local',local:true},{id:'laptop-new',environmentId:'laptop'},{id:'vps',environmentId:'vps'}];
  const locations=[{connectionId:'laptop-old',environmentId:'laptop',parentPath:'C:\\Projects',selectedAt:'2026-10-20T12:00:00Z'},{connectionId:'vps',environmentId:'vps',parentPath:'/work',selectedAt:'2026-10-20T11:00:00Z'}];
  assert.deepEqual(projectCreationDefaults(locations,machines,'device'),{machineId:'laptop-new',parentPath:'C:\\Projects'});
  assert.deepEqual(projectCreationDefaults(locations,machines,'device','vps'),{machineId:'vps',parentPath:'/work'});
  assert.deepEqual(projectCreationDefaults(locations,[machines[0]],'device'),{machineId:'local',parentPath:'~'});
  const next=rememberProjectCreationLocation(locations,{...locations[1],parentPath:'/new',selectedAt:'2026-10-20T13:00:00Z'});
  assert.equal(next.length,2);assert.equal(projectCreationDefaults(next,machines,'device').parentPath,'/new');
});

test('local defaults cannot follow This computer to a different desktop; known environments can become remote',()=>{
  const locations=[{connectionId:'',environmentId:'desktop-a',deviceId:'a',parentPath:'C:\\Projects',selectedAt:'2026-10-20T12:00:00Z'}];
  assert.equal(projectCreationDefaults(locations,[{id:'local',local:true}],'b').parentPath,'~');
  assert.equal(projectCreationDefaults(locations,[{id:'remote',environmentId:'desktop-a'}],'b').parentPath,'C:\\Projects');
  assert.equal(projectCreationDefaults(locations,[{id:'local',local:true}],'a').parentPath,'C:\\Projects');
  const remote={...locations[0],connectionId:'remote',deviceId:undefined};
  assert.equal(projectCreationDefaults([remote],[{id:'local',local:true,environmentId:'desktop-a'},{id:'remote',environmentId:'desktop-a'}],'a').machineId,'remote');
  assert.deepEqual(loadProjectCreationLocations([null,{}, {...locations[0],selectedAt:'invalid'},...locations]),locations);
});

test('desktop folder creation makes an empty folder and preserves colliding files',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'t3-new-workspace-'));
  try{
    const folder=await createDesktopFolder(parent,'Café project');
    assert.deepEqual(await readdir(folder),[]);
    await assert.rejects(createDesktopFolder(parent,'Café project'),/already exists/);
    await writeFile(join(parent,'existing'),'keep');
    await assert.rejects(createDesktopFolder(parent,'existing'),/already exists/);
    assert.equal(await readFile(join(parent,'existing'),'utf8'),'keep');
    await assert.rejects(createDesktopFolder(parent,'../escape'),/valid folder name/);
  }finally{await rm(parent,{recursive:true,force:true});}
});
