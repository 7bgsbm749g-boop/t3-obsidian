import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseProjects,runBridge,configureBridge} from '../bridge';
import {ThreadAccessCache} from '../thread-access-cache';
test('discovery validates projects and allows an empty environment',()=>{
 assert.deepEqual(parseProjects({projects:[]}),[]);
 assert.throws(()=>parseProjects({projects:[{id:'x'}]}));
 assert.throws(()=>parseProjects({projects:[{id:'x',title:'a',workspaceRoot:'/'},{id:'x',title:'b',workspaceRoot:'/'}]}));
});
test('local discovery borrows the existing credential cache without issuing or revoking a CLI session per read',async()=>{
 let opened=0,closed=0;const project={id:'scratch',title:'No project',workspaceRoot:'/scratch'};
 const cache=new ThreadAccessCache(async()=>{opened++;return {origin:'http://127.0.0.1:1234',api:async(path:string)=>path.endsWith('no-project')?{projectId:project.id}:{projects:[project]},close:async()=>{closed++;}};});
 configureBridge({mobile:false,localAccess:()=>cache.get('local')});
 try{
  const connection={host:'local',executable:'/must-not-start-a-cli',baseDir:'/no-runtime-required'};
  assert.deepEqual(await runBridge(connection,['no-project']),project);
  assert.deepEqual(await runBridge(connection,['projects']),{projects:[project]});
  assert.equal(opened,1);assert.equal(closed,0);
 }finally{await cache.dispose();configureBridge({mobile:false});}
 assert.equal(closed,1);
});
