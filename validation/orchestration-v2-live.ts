/** Bounded integration smoke against the installed local T3 server.
 * Uses a temporary CLI session; never writes or logs its credential. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {desktopThreadAccess} from '../desktop';
import {readNewThreadDefaults} from '../model-defaults';
import {watchThread,readInlineSnapshot} from '../thread-stream';
import {applyThreadItem,turnForMessage,turnPhase,type InlineThreadState} from '../inline-thread';

async function main(){
  const evidence=process.argv[2];if(!evidence)throw Error('Supply an evidence JSON path outside the vault.');
  const access=await desktopThreadAccess({host:'local',executable:'/home/ubuntu/.local/bin/t3'} as any);
  let watcher:ReturnType<typeof watchThread>|undefined;
  const threadId=randomUUID(),messageId=randomUUID(),marker='T3_V2_LIVE_'+randomUUID().slice(0,8);
  let state:InlineThreadState={messages:[],activities:[]},events=0,snapshots=0;
  const beganAt=new Date().toISOString();
  try{
    const shell=await access.api('/api/orchestration/shell');
    const project=shell.projects.find((p:any)=>p.workspaceRoot==='/home/ubuntu/projects/send-to-t3-code');assert.ok(project,'Canonical plugin project must exist');
    const defaults=await readNewThreadDefaults(access.api,access.origin,project);
    await access.api('/api/orchestration/dispatch',{type:'thread.create',commandId:randomUUID(),threadId,projectId:project.id,title:'Orchestrator v2 integration smoke',...defaults,interactionMode:'default',branch:null,worktreePath:null,createdAt:beganAt});
    watcher=watchThread(threadId,async()=>access,{item:item=>{state=applyThreadItem(state,item).state;if(item.kind==='snapshot')snapshots++;else if(item.kind==='event')events++;},reconnecting:()=>{}},undefined,undefined,{pollSnapshots:false,afterSequence:()=>state.sequence});
    await access.api('/api/orchestration/dispatch',{type:'thread.turn.start',commandId:randomUUID(),threadId,createdAt:beganAt,message:{messageId,role:'user',text:`This is a bounded plugin integration test. Reply with exactly ${marker}. Do not use tools or modify files.`,attachments:[]}});
    const deadline=Date.now()+150000;
    while(Date.now()<deadline){
      const snapshot=await readInlineSnapshot(access,threadId,project.id);
      state=applyThreadItem(state,{kind:'snapshot',snapshot}).state;
      const id=turnForMessage(state,messageId);
      if(id&&turnPhase(state,id)!=='running')break;
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    const runId=turnForMessage(state,messageId);assert.ok(runId);assert.equal(turnPhase(state,runId),'complete');
    assert.ok(state.messages.some(m=>m.role==='assistant'&&m.turnId===runId&&m.text.trim()===marker));
    assert.ok(events>0||snapshots>0,'Real websocket subscription must deliver data');
    const imageMessageId=randomUUID(),imageMarker=marker+'_IMAGE';
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
    await access.api('/api/orchestration/dispatch',{type:'thread.turn.start',commandId:randomUUID(),threadId,createdAt:new Date().toISOString(),message:{messageId:imageMessageId,text:`Image upload test. Ignore the attached image and reply with exactly ${imageMarker}. Do not use tools or modify files.`,attachments:[{type:'image',id:randomUUID(),name:'synthetic.png',mimeType:'image/png',sizeBytes:Buffer.from(png,'base64').length,dataUrl:'data:image/png;base64,'+png}]}});
    const imageDeadline=Date.now()+150000;
    while(Date.now()<imageDeadline){state=applyThreadItem(state,{kind:'snapshot',snapshot:await readInlineSnapshot(access,threadId,project.id)}).state;const id=turnForMessage(state,imageMessageId);if(id&&turnPhase(state,id)!=='running')break;await new Promise(resolve=>setTimeout(resolve,1500));}
    const imageRunId=turnForMessage(state,imageMessageId);assert.ok(imageRunId);assert.equal(turnPhase(state,imageRunId),'complete');
    assert.ok(state.messages.some(m=>m.role==='assistant'&&m.turnId===imageRunId&&m.text.trim()===imageMarker));
    const uploaded=state.messages.find(m=>m.id===imageMessageId) as any;assert.equal(uploaded.attachments?.length,1);assert.ok(!uploaded.attachments[0].dataUrl);
    const stopMessageId=randomUUID();
    await access.api('/api/orchestration/dispatch',{type:'thread.turn.start',commandId:randomUUID(),threadId,createdAt:new Date().toISOString(),message:{messageId:stopMessageId,text:'This is a Stop control test. Wait for the cancellation. Do not modify files.',attachments:[]}});
    state=applyThreadItem(state,{kind:'snapshot',snapshot:await readInlineSnapshot(access,threadId,project.id)}).state;
    const stopRunId=turnForMessage(state,stopMessageId);assert.ok(stopRunId);
    await access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:randomUUID(),threadId,turnId:stopRunId});
    const stopDeadline=Date.now()+30000;
    while(Date.now()<stopDeadline){state=applyThreadItem(state,{kind:'snapshot',snapshot:await readInlineSnapshot(access,threadId,project.id)}).state;if(turnPhase(state,stopRunId)!=='running')break;await new Promise(resolve=>setTimeout(resolve,1000));}
    assert.equal(turnPhase(state,stopRunId),'interrupted');
    const result={status:'passed',beganAt,finishedAt:new Date().toISOString(),threadId,messageId,runId,marker,imageMessageId,imageRunId,imageMarker,stopMessageId,stopRunId,protocolVersion:2,events,snapshots,checks:['RPC thread creation and message dispatch','authenticated v2 subscription','bounded HTTP projection','exact app run binding and terminal reply','real image persistence and provider delivery','real app run interrupt and terminal cancellation']};
    await writeFile(evidence,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }finally{watcher?.stop();await access.close?.();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
