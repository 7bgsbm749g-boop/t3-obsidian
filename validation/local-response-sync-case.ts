import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {contentHash} from '../completion';
import {responseAnchor} from '../native-response-projection';
import {LocalResponseManager} from '../local-response-manager';
import {mergeResponseBindingData,updateResponseBindingData,responseBindingRequests,type ResponseBindingData} from '../response-binding-data';
import type {ResponseRequest} from '../response-model';
import type {DirectInlineUpdate} from '../direct-inline-preview';

const request=():ResponseRequest=>({version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:'synthetic-sync-lab',host:{environmentId:'synthetic',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Synthetic.md',threadId:randomUUID(),projectId:randomUUID(),messageId:randomUUID(),threadEnvironmentId:'synthetic',initialHash:contentHash(''),createdAt:'2026-10-15T00:00:00Z'});
const drain=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
async function consume(document:string,records:ResponseBindingData,complete:boolean){
  let emit:((update:DirectInlineUpdate)=>void)|undefined,active:ResponseRequest|undefined;
  const io:any={localBindings:()=>responseBindingRequests(records),saveLocalBinding:async(request:ResponseRequest)=>{records=updateResponseBindingData(records,request,'replay');},readNote:async()=>document,updateNote:async(_path:string,change:(document:string)=>string)=>document=change(document),saveLocalNote:async()=>{},openedNotes:()=>[{path:'Synthetic.md',document}],isOpen:()=>true,syncReady:()=>true,access:async()=>{throw Error('This replay does not dispatch T3 work.');}};
  const manager=new LocalResponseManager(randomUUID(),'synthetic-sync-lab',io,{read:async()=>document,compareAndSet:async(_path,before,after,guard)=>{if(document!==before||guard?.()===false)return false;document=after;return true;}},undefined,(record,_access,receive)=>{active=record.request;emit=receive;return {tick:()=>{},update:()=>{},reconnect:()=>{},delivery:()=>{},suspend:()=>{},dispose:()=>{}} as any;});
  manager.resume();await drain();const attached=!!active;
  if(complete&&emit&&active){emit({request:active,messageId:active.messageId,sequence:10,turnId:'synthetic-exact-turn',body:'LOCAL_FINAL_SAVE_LAB_ANSWER',phase:'complete',completionVerified:true});await drain();}
  manager.dispose();return {document,attached};
}
void (async()=>{
  const mode=process.argv[2];
  if(mode==='consume'){const value=JSON.parse(readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(await consume(value.document,value.settings?.responseBindings??{},value.complete===true)));return;}
  if(mode==='merge'){const value=JSON.parse(readFileSync(0,'utf8'));process.stdout.write(JSON.stringify({responseBindings:mergeResponseBindingData(...value.map((settings:any)=>settings?.responseBindings))}));return;}
  const a=request(),b=request(),initial=`Before\n\n${responseAnchor(a.id)}\n\nAfter\n`,second=`Before\n\n${responseAnchor(b.id)}\n\nAfter\n`;
  process.stdout.write(JSON.stringify({initial,second,settingsA:{responseBindings:updateResponseBindingData({},a,'A',1)},settingsB:{responseBindings:updateResponseBindingData({},b,'B',1)}}));
})();
