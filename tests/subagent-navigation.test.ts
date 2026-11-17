import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {sidebarTarget} from '../src/conversations/sidebar-thread-model';
import {parseHTML} from 'linkedom';
const compiled=build({entryPoints:['src/conversations/sidebar-thread-view.ts'],bundle:true,platform:'browser',format:'cjs',write:false});
const reference={version:1 as const,environmentId:'local',threadId:'parent',runId:'run',subagentId:'task'};
async function fixture(remote=false){
 const module={exports:{} as any};class Component{};const {document,window}=parseHTML('<html><body></body></html>');
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:()=>({Component,ItemView:Component,FuzzySuggestModal:Component,Modal:Component,Setting:Component,Notice:Component,setIcon(){}}),console,setTimeout,clearTimeout,URL,URLSearchParams,AbortController,document,window,performance});
 const opened:any[]=[],reads:any[]=[],closed:string[]=[];
 let status='running',runId='run',removed=false,deleted=false,wrongIdentity=false;
 const child=()=>({id:'task',runId,title:'Check configuration',status,childThreadId:remote?null:'child',...(remote?{remoteChild:{environmentId:'remote',threadId:'child',label:'Remote'}}:{})});
 const owner=new module.exports.SidebarThreads({}, {}, {uuid:()=>'',access:async(environment:string)=>({origin:'https://synthetic.invalid',close:async()=>{closed.push(environment);},api:async(path:string)=>{
  reads.push([environment,path]);const parent=path.includes('/parent?');
  return {snapshotSequence:1,projection:{thread:{id:wrongIdentity?'wrong':parent?'parent':'child',projectId:parent?'parent-project':'child-project',...(deleted&&!parent?{deletedAt:'2026-01-01T00:00:00Z'}:{})},runs:parent?[{id:'run',ordinal:1,status:'completed',userMessageId:'prompt'}]:[],messages:[],runtimeRequests:[],turnItems:[],subagents:parent&&!removed?[child()]:[]}};
 }})});
 owner.open=async(target:any)=>{assert.ok(sidebarTarget(target));opened.push(target);};
 return {owner,opened,reads,closed,remove:()=>{removed=true;},wrongRun:()=>{runId='other';},wrongIdentity:()=>{wrongIdentity=true;},deleteChild:()=>{deleted=true;}};
}
for(const remote of [false,true])test(`a ${remote?'remote':'local'} row opens only its fresh canonical child in the subagent sidebar`,async()=>{
 const f=await fixture(remote);await f.owner.openSubagent(reference);
 assert.equal(f.opened.length,1);const target=f.opened[0];
 assert.equal(target.kind,'subagent');assert.equal(target.threadId,'child');assert.equal(target.projectId,'child-project');assert.equal(target.environmentId,remote?'remote':'local');assert.equal(target.parent.threadId,'parent');assert.equal(target.parent.projectId,'parent-project');assert.equal(target.parent.environmentId,'local');
 assert.equal(f.reads.length,2);assert.deepEqual(f.closed,remote?['local','remote']:['local','local']);assert.ok(f.reads.every(([,path])=>!path.includes('dispatch')));
});
for(const failure of ['remove','wrongRun','wrongIdentity','deleteChild'] as const)test(`unavailable or mismatched subagents fail closed (${failure})`,async()=>{
 const f=await fixture();f[failure]();await assert.rejects(f.owner.openSubagent(reference));assert.equal(f.opened.length,0);assert.ok(f.closed.length>0);
});
