// Remove a finished checkout through T3, after fresh app and process checks.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const input=JSON.parse(await new Promise(resolve=>{let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>{data+=part;});process.stdin.on('end',()=>resolve(data));}));
const target=path.resolve(input.path);
const cli=(...args)=>execFileSync(input.t3Command,args,{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
let session;
let socket;
function busy(message){return {status:'pending',reason:message};}
async function cleanup(){
  if(process.platform!=='linux')return busy('Automatic checkout cleanup requires a process check supported on this machine.');
  for(const pid of await fs.readdir('/proc')){
    if(!/^\d+$/.test(pid)||Number(pid)===process.pid)continue;
    try{
      const cwd=await fs.readlink('/proc/'+pid+'/cwd');
      if(cwd===target||cwd.startsWith(target+path.sep))return busy('A process still uses the checkout.');
    }catch(error){if(!['ENOENT','ESRCH','EACCES'].includes(error.code))throw error;}
  }
  const runtime=JSON.parse(await fs.readFile(path.join(input.t3BaseDir,'userdata/server-runtime.json'),'utf8'));
  const origin=new URL(runtime.origin);
  if(origin.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('T3 cleanup requires its verified loopback origin.');
  session=JSON.parse(cli('auth','session','issue','--base-dir',input.t3BaseDir,'--ttl','5m','--label','release-checkout-cleanup','--json'));
  if(!session.token||!session.sessionId)throw Error('T3 did not issue a cleanup session.');
  async function request(route,payload){
    const response=await fetch(new URL(route,origin),{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json','x-t3-orchestration-protocol':'2'},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)throw Error('T3 cleanup returned HTTP '+response.status);
    const data=await response.text();if(data.length>16*1024*1024)throw Error('T3 cleanup response exceeded its limit.');return JSON.parse(data);
  }
  const shell=await request('/api/orchestration/shell');
  if(!Array.isArray(shell.threads)||!Array.isArray(shell.projects))throw Error('T3 did not return checkout ownership.');
  if(shell.projects.some(project=>project.workspaceRoot&&path.resolve(project.workspaceRoot)===target))return busy('The checkout is a registered project root.');
  const members=[...shell.threads,...(shell.archivedThreads??[])].filter(thread=>thread.worktreePath&&path.resolve(thread.worktreePath)===target);
  if(members.some(thread=>thread.activeRunId||['preparing','queued','starting','running','waiting'].includes(thread.status)||thread.pendingRuntimeRequest||(thread.pendingBackgroundTasks?.length??0)>0))return busy('A T3 thread still uses the checkout.');
  const git=(...args)=>execFileSync('git',['--no-optional-locks','-C',target,...args],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024}).trim();
  if(git('rev-parse','HEAD')!==input.commit||git('symbolic-ref','--short','HEAD')!==input.branch)return busy('The source branch changed before checkout removal.');
  if(git('status','--porcelain=v1'))return {status:'blocked',reason:'The source has uncommitted files.'};
  const {ticket}=await request('/api/auth/websocket-ticket',{});
  if(!ticket)throw Error('T3 did not issue a cleanup socket ticket.');
  const url=new URL('/ws',origin);url.protocol='ws:';url.searchParams.set('wsTicket',ticket);url.searchParams.set('orchestrationProtocol','2');
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{socket?.close();reject(Error('T3 checkout cleanup timed out.'));},20000);
    const done=(error)=>{clearTimeout(timeout);error?reject(error):resolve();};
    socket=new WebSocket(url);
    socket.onopen=()=>socket.send(JSON.stringify({_tag:'Request',id:'1',tag:'vcs.removeWorktree',payload:{cwd:input.canonical,path:target,force:false},headers:[]}));
    socket.onerror=()=>done(Error('T3 checkout cleanup socket failed.'));
    socket.onmessage=event=>{
      try{
        const decoded=JSON.parse(event.data);
        for(const frame of Array.isArray(decoded)?decoded:[decoded]){
          if(frame._tag==='Ping')socket.send(JSON.stringify({_tag:'Pong'}));
          if(frame._tag==='Exit'&&String(frame.requestId)==='1')done(frame.exit?._tag==='Success'?undefined:Error('T3 refused checkout cleanup.'));
        }
      }catch{done(Error('T3 returned an invalid cleanup acknowledgement.'));}
    };
  });
  return {status:'removed'};
}
try{console.log(JSON.stringify(await cleanup()));}
catch{console.log(JSON.stringify({status:'pending',reason:'T3 checkout cleanup is unavailable; the checkout and branch remain protected.'}));}
finally{
  socket?.close();
  if(session?.sessionId){try{cli('auth','session','revoke','--base-dir',input.t3BaseDir,session.sessionId);}catch{console.error('Cleanup session revocation failed; it expires within five minutes.');}}
}
