// Read/evaluate the owned Android test WebView; never attach to Chrome profiles.
import {readFile} from 'node:fs/promises';
const [endpoint,expressionFile]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint??'')||!expressionFile)throw Error('Use the lab adb-forward loopback endpoint and an expression file.');
const version=await (await fetch(endpoint+'/json/version')).json();
if(version['Android-Package']!=='md.obsidian')throw Error('The forwarded WebView does not belong to Android Obsidian.');
const targets=await (await fetch(endpoint+'/json/list')).json();
const target=targets.find(item=>item.type==='page'&&new URL(item.url).hostname==='localhost');
if(!target?.webSocketDebuggerUrl)throw Error('The lab Obsidian WebView is unavailable.');
const socket=new WebSocket(target.webSocketDebuggerUrl);
const timer=setTimeout(()=>{socket.close();throw Error('Mobile WebView operation timed out.');},30000);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
const result=new Promise((resolve,reject)=>socket.addEventListener('message',event=>{const item=JSON.parse(event.data);if(item.id!==1)return;if(item.error)reject(Error(JSON.stringify(item.error)));else resolve(item.result);}));
socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:await readFile(expressionFile,'utf8'),awaitPromise:true,returnByValue:true}}));
try{const value=await result;if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));process.stdout.write(JSON.stringify(value.result?.value??null,null,2)+'\n');}finally{clearTimeout(timer);socket.close();}
