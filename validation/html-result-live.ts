/** Read-only integration check for an existing real T3 HTML result. No prompt
 * is dispatched. Short-lived local credentials and signed URLs stay in memory. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {desktopThreadAccess} from '../desktop';
import {HtmlResultStore} from '../html-result-store';
import {htmlRenderFromToolItem,readHtmlResult,renderHtmlResult} from '../html-results';
import {contentHash} from '../completion';
async function main(){
 const [threadId,itemId,evidence]=process.argv.slice(2);if(!threadId||!itemId||!evidence)throw Error('Supply thread ID, HTML tool item ID and a private evidence JSON path.');
 const access=await desktopThreadAccess({host:'local',executable:'/home/ubuntu/.local/bin/t3'});
 try{
  const descriptor=await (await fetch(new URL('/.well-known/t3/environment',access.origin))).json() as any;
  const item=await access.api('/api/orchestration/turn-item',{threadId,itemId}),page=htmlRenderFromToolItem(item);assert.ok(page,'The exact completed HTML item must exist');
  const reference=readHtmlResult({version:1,environmentId:descriptor.environmentId,threadId,runId:item.runId,itemId,revision:item.updatedAt,...page});assert.ok(reference);
  const values=new Map<string,unknown>(),storage={read:async(key:string)=>values.get(key),write:async(key:string,value:unknown)=>{values.set(key,value);}};
  let downloads=0;
  const store=new HtmlResultStore(storage,async()=>({...access,close:()=>{}}),async url=>{downloads++;const r=await fetch(url,{credentials:'omit',redirect:'error'});return {status:r.status,mimeType:r.headers.get('content-type')??'',bytes:await r.arrayBuffer()};});
  const html=await store.get(reference);assert.ok(html.includes('t3-theme'));assert.ok(html.includes('<script>'));assert.equal(downloads,1);store.dispose();
  const offline=new HtmlResultStore(storage,async()=>{throw Error('Offline');},async()=>{throw Error('Offline');});assert.equal(await offline.get(reference),html);offline.dispose();
  const result={status:'passed',at:new Date().toISOString(),reference,byteLength:Buffer.byteLength(html),htmlSha256:contentHash(html),offlineReload:true,downloads};
  await writeFile(evidence,JSON.stringify(result,null,2)+'\n',{flag:'wx'});await writeFile(evidence+'.md',renderHtmlResult(reference)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
 }finally{await access.close?.();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
