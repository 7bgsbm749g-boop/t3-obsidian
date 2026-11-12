import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {settingsSocket} from './rpc-fixture';
import {runInNewContext} from './obsidian-context';
const compiled=build({entryPoints:['src/projects/workspace-panel.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
async function fixture(){const module={exports:{} as any};runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,URL,require:()=>({Modal:class{}})});return module.exports;}
const target={projectId:'p',threadId:'t',workspaceRoot:'/project',environmentId:'machine'};
test('workspace binds worktree and lineage to the exact thread and project',async()=>{
 const {workspaceData}=await fixture();const detail={projection:{thread:{id:'t',projectId:'p',worktreePath:'/worktree',lineage:{rootThreadId:'root'},pullRequests:[{number:1},{number:2,source:'stack-dismissed'}]}}};
 const data=workspaceData(target,{threads:[{id:'same',projectId:'p',lineage:{rootThreadId:'root'}},{id:'other-project',projectId:'q',lineage:{rootThreadId:'root'}},{id:'unrelated',projectId:'p',lineage:{rootThreadId:'other'}}]},detail,{isRepo:true,refName:'feature',workingTree:{files:[],insertions:4,deletions:2}});
 assert.equal(data.cwd,'/worktree');assert.equal(data.branch,'feature');assert.equal(data.relatives.length,1);assert.equal(data.relatives[0].id,'same');assert.equal(data.pullRequests.length,1);
 assert.throws(()=>workspaceData({...target,projectId:'other'}, {},detail,{isRepo:true}),/no longer/);
});
test('external PR links reject scripts and embedded credentials',async()=>{const {safeWebLink}=await fixture();for(const value of ['javascript:alert(1)','file:///tmp/x','https://secret@example.com'])assert.equal(safeWebLink(value),undefined);assert.equal(safeWebLink('https://github.com/org/repo/pull/1'),'https://github.com/org/repo/pull/1');});


test('workspace reads only the exact worktree through authenticated RPC and closes access',async()=>{
 const calls:any[]=[],closed:string[]=[];const module={exports:{} as any};
 const Socket=settingsSocket(undefined,undefined,(tag,payload)=>{calls.push({tag,payload});return {isRepo:true,refName:'feature',workingTree:{files:[]}};});
 class Tracked extends Socket {close(){closed.push('socket');super.close();}}
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,URL,WebSocket:Tracked,performance,setTimeout,clearTimeout,require:()=>({Modal:class{}})});
 const api=async(route:string)=>{calls.push(route);if(route==='/api/auth/websocket-ticket')return {ticket:'one-use'};if(route==='/api/orchestration/shell')return {threads:[]};return {projection:{thread:{id:'t',projectId:'p',worktreePath:'/worktree'}}};};
 const data=await module.exports.readWorkspace(target,async()=>({api,origin:'https://machine.example',close:()=>closed.push('access')}));
 assert.equal(data.cwd,'/worktree');assert.equal(calls.at(-1).tag,'vcs.refreshStatus');assert.equal(calls.at(-1).payload.cwd,'/worktree');assert.deepEqual(closed,['socket','access']);
});
