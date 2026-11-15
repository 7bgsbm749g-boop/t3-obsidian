// Runs only a locally built disposable native fixture on its own Xvfb display.
import {readFile,writeFile,access,copyFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const evidence=resolve(process.argv[2]??''),key=process.argv[3];if(!key)throw Error('Supply evidence directory and a unique session key.');
const runtime=JSON.parse(await readFile(join(evidence,'RUNTIME.json'),'utf8'));
if(!runtime.runtime.startsWith(join(tmpdir(),'t3-sync-stream-native-'))||runtime.profile!==join(runtime.runtime,'profile')||runtime.vault!==join(runtime.runtime,'vault')||runtime.evidence!==evidence)throw Error('Refusing a non-fixture runtime.');
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(await exists(join(evidence,'RESULT.json'))||await exists(join(evidence,'CLEANUP.json')))throw Error('Use a new fixture; prior results must be retained.');
const session=JSON.parse(execFileSync('t3-session',['start','--key',key,'--purpose','Synthetic native stream and Sync checks on an isolated display','--gui','--memory','1G','--','/usr/bin/xvfb-run','-a','/opt/Obsidian/obsidian','--user-data-dir='+runtime.profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-sandbox'],{encoding:'utf8'}));
if(session.reused)throw Error('A unique fixture session is required.');
let socket,sequence=0,bootstrapped=false;const pending=new Map(),consoleEvents=[];
function evaluate(expression){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});}
try{
 const end=Date.now()+60000;
 while(Date.now()<end){
  if(await exists(join(evidence,'CLEANUP.json')))break;
  if(!socket&&await exists(join(runtime.profile,'DevToolsActivePort'))){
   const port=Number((await readFile(join(runtime.profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
   let pages;try{pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}catch(error){if(error.cause?.code==='ECONNREFUSED'){await pause(250);continue;}throw error;}
   const page=pages.find(page=>page.url==='app://obsidian.md/index.html');
   if(page){socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.method==='Runtime.consoleAPICalled'||value.method==='Runtime.exceptionThrown'||value.result?.exceptionDetails){consoleEvents.push(value);if(consoleEvents.length>40)consoleEvents.shift();}const job=pending.get(value.id);if(job){pending.delete(value.id);value.result?.exceptionDetails?job.reject(Error(value.result.exceptionDetails.exception?.description??value.result.exceptionDetails.text)):job.resolve(value.result?.result?.value);}};}
  }
  if(socket&&!bootstrapped){
   const result=JSON.parse(await evaluate(`JSON.stringify((()=>{if(typeof app==='undefined'||!app.vault?.adapter?.basePath||!app.plugins?.plugins)return {ready:false};if(app.vault.adapter.basePath!==${JSON.stringify(runtime.vault)})throw Error('Unexpected test vault');const trust=[...document.querySelectorAll('button')].find(button=>button.textContent==='Trust author and enable plugins');if(trust){trust.click();return {ready:true,trustedOwnFixture:true};}return {ready:!!app.plugins.plugins['sync-stream-lab']};})())`));
   bootstrapped=result.ready;if(bootstrapped)socket.send(JSON.stringify({id:0,method:'Runtime.enable'}));
  }
  await pause(250);
 }
 if(!await exists(join(evidence,'CLEANUP.json')))throw Error('Native fixture did not complete within sixty seconds.');
 if(await exists(join(evidence,'ERROR.json')))throw Error(await readFile(join(evidence,'ERROR.json'),'utf8'));
 console.log(await readFile(join(evidence,'RESULT.json'),'utf8'));
}finally{
 socket?.close();for(const job of pending.values())job.reject(Error('Fixture transport closed'));pending.clear();
 await writeFile(join(evidence,'CONSOLE.json'),JSON.stringify(consoleEvents,null,2));
 try{await copyFile(join(runtime.profile,'obsidian.log'),join(evidence,'obsidian.log'));}catch{/* Early startup can fail before the app creates its log. */}
 execFileSync('t3-session',['release',session.id],{stdio:'pipe'});
 // This exact service was created above, with a unique disposable profile and
 // display. Stop its owned process tree after retaining results, even on failure.
 try{execFileSync('systemctl',['--user','stop',session.unit],{stdio:'pipe'});}catch(error){const state=execFileSync('systemctl',['--user','show',session.unit,'--property=ActiveState','--value'],{encoding:'utf8'}).trim();if(state!=='inactive')throw error;}
 const remainingNotes=(await readdir(runtime.vault,{recursive:true})).filter(name=>name.endsWith('.md'));
 await writeFile(join(evidence,'PROCESS-CLEANUP.json'),JSON.stringify({unit:session.unit,stopped:true,owner:'this fixture runner',syntheticOnly:true,remainingNotes},null,2));
 if(remainingNotes.length)throw Error('Temporary native notes remain: '+remainingNotes.join(', '));
}
