import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {environmentApi,commandId} from '../direct';
import {readInlineSnapshot} from '../thread-stream';
import {applyThreadItem,turnForMessage,turnPhase} from '../inline-thread';

async function main(){
  const evidence=resolve(process.argv[2]??'');if(!evidence.startsWith('/home/ubuntu/backups/send-to-t3-code/'))throw Error('Private lab evidence directory required.');
  const json=async(name:string)=>JSON.parse(await readFile(join(evidence,name),'utf8'));
  const lab=await json('LAB.json'),local=await json('credential-b.json'),session=local.pairedSessions[lab.connectionId];
  const api=await environmentApi({transport:'direct',host:'direct',executable:'',url:session.url,environmentId:lab.environmentId},session),access={origin:session.url,api};
  const beforeNew=await json('before-new.json'),beforePrevious=await json('before-previous.json'),baseline=await json('baseline-nonstream.json');
  assert.equal(beforeNew.ok,false);assert.equal(beforePrevious.ok,false);
  for(const failure of [beforeNew,beforePrevious])assert.match(failure.error,/streaming host no longer matches/);
  const shell=await api('/api/orchestration/shell');assert.ok(!shell.threads.some((t:any)=>t.id===commandId(beforeNew.id,'thread')),'Failed preparation must not create a thread');
  const old=await readInlineSnapshot(access,baseline.threadId,lab.projectId);
  assert.ok(!old.thread.messages.some((m:any)=>m.id===commandId(beforePrevious.id,'message')),'Failed previous send must not dispatch');
  const newResult=await json('after-new.json'),previous=await json('after-previous.json');assert.equal(newResult.ok,true);assert.equal(previous.ok,true);assert.equal(previous.threadId,newResult.threadId);
  const replies:any[]=[];
  for(const [request,marker] of [[newResult,'REMOTE_DELIVERY_NEW_OK'],[previous,'REMOTE_DELIVERY_PREVIOUS_OK']] as const){
    const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:await readInlineSnapshot(access,request.threadId,lab.projectId)}).state;
    const runId=turnForMessage(state,request.messageId);assert.ok(runId);assert.equal(turnPhase(state,runId),'complete');
    const reply=state.messages.find(m=>m.role==='assistant'&&m.turnId===runId&&m.text.trim()===marker);assert.ok(reply,`Exact completed reply ${marker} required`);
    replies.push({threadId:request.threadId,messageId:request.messageId,runId,replyId:reply.id,reply:reply.text.trim()});
  }
  for(const role of ['a','b'])await writeFile(join(evidence,`${role}-observe.json`),JSON.stringify({id:'final-observation'}));
  const deadline=Date.now()+30000;let observations:any[]=[];
  while(Date.now()<deadline){
    try{observations=await Promise.all(['a','b'].map(role=>json(`${role}-final-observation.json`)));if(observations.every(o=>o.note?.includes('> REMOTE_DELIVERY_PREVIOUS_OK')&&o.editor===o.note&&o.visible?.includes('REMOTE_DELIVERY_PREVIOUS_OK')))break;}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  assert.equal(observations.length,2);assert.equal(observations[0].note,observations[1].note);
  for(const o of observations){assert.equal(o.editorPath,lab.note);assert.equal(o.editor,o.note);assert.ok(o.visible.includes('REMOTE_DELIVERY_PREVIOUS_OK'));assert.ok(o.settingsBytes>1048576);}
  const result={status:'passed',at:new Date().toISOString(),lab:lab.folder,transport:'real authenticated remote RPC between separate VPS vault paths',before:{version:lab.oldVersion,archiveSha256:lab.oldArchiveSha256,newError:beforeNew.error,previousError:beforePrevious.error,noFailedDispatch:true,rpc:await json('api-before.json')},after:{replies,rpc:await json('api-after.json'),savedNoteSha256:createHash('sha256').update(observations[0].note).digest('hex'),openEditorsAdoptedWithoutReload:true},coverage:{realT3:true,officialHeadlessSync:true,desktopEditors:true,nativeWindows:false,nativeMobile:false}};
  await writeFile(join(evidence,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
