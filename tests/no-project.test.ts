import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureNoProject,NO_PROJECT,noProjectKey,noProjectMachine,isNoProjectKey} from '../no-project';
import {t3Api} from '../t3-api';
import {readDirect} from '../direct';
import {settingsSocket} from './rpc-fixture';

test('No project uses T3 native setup and retains its actual ID and workspace',async()=>{
  const calls:string[]=[];
  const Socket=settingsSocket(undefined,undefined,(tag,payload)=>{assert.equal(tag,'projects.ensureScratch');assert.deepEqual(payload,{});return {projectId:'scratch'};});
  const api=t3Api(async(path,payload)=>{
    calls.push(path);
    if(path==='/api/auth/websocket-ticket')return {ticket:'test-ticket'};
    assert.equal(path,'/api/orchestration/shell');assert.equal(payload,undefined);
    return {projects:[{id:'scratch',title:'Server title',workspaceRoot:'/t3/scratch'},{id:'vault',title:'Vault',workspaceRoot:'/vault'}]};
  },'https://t3.example',url=>new Socket(url) as unknown as WebSocket);
  assert.deepEqual(await ensureNoProject(api),{id:'scratch',title:'No project',workspaceRoot:'/t3/scratch'});
  assert.deepEqual(calls,['/api/auth/websocket-ticket','/api/orchestration/shell']);
});

test('No project setup refuses an invalid native identity or missing workspace',async()=>{
  await assert.rejects(ensureNoProject(async()=>({projectId:null})),/does not support/);
  await assert.rejects(ensureNoProject(async path=>path.endsWith('no-project')?{projectId:'scratch'}:{projects:[]}),/has not returned/);
});

test('No project choices retain an exact machine and cannot match ordinary project IDs',()=>{
  assert.equal(isNoProjectKey(NO_PROJECT),true);
  for(const machine of ['local','paired-id','environment:discovered'])assert.equal(noProjectMachine(noProjectKey(machine)),machine);
  assert.equal(isNoProjectKey('paired-id:project'),false);
});

test('remote setup retains connection validation before opening No project',async()=>{
  await assert.rejects(readDirect({transport:'direct',host:'direct',executable:'',url:'https://t3.example',connectionId:'c',environmentId:'env'},['no-project']),/Pair this connection/);
});
