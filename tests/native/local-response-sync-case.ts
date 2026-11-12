import {savedResponseProof} from '../../src/responses/saved-response-proof';
import {loadSmartSend,rememberResponse} from '../../src/notes/smart-send';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {contentHash} from '../../src/responses/completion';
import {responseAnchor} from '../../src/responses/native-response-projection';
import {LocalResponseManager} from '../../src/responses/local-response-manager';
import {completeResponseBinding,mergeResponseBindingData,updateResponseBindingData,responseBindingRequests,type ResponseBindingData} from '../../src/responses/response-binding-data';
import type {ResponseRequest} from '../../src/responses/response-model';
import type {DirectInlineUpdate} from '../../src/responses/direct-inline-preview';

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
  if(mode==='peer-save'){
    const value=JSON.parse(readFileSync(0,'utf8')),records=value.settings.responseBindings,binding=responseBindingRequests(records)[0],data=loadSmartSend(undefined),body='SYNC_PEER_COMPLETION_PROOF';
    await rememberResponse(data,binding.notePath,binding.id,body,'Before\n\n','\n\nAfter',8);
    process.stdout.write(JSON.stringify({document:'Before\n\n'+body+'\n\nAfter\nCompatible later edit',settings:{responseBindings:completeResponseBinding(records,binding,'synthetic-exact-turn',contentHash(body),'peer'),smartSend:data},binding}));return;
  }
  if(mode==='reconcile'){
    const value=JSON.parse(readFileSync(0,'utf8')),binding:ResponseRequest=value.binding;let document=responseAnchor(binding.id),records=updateResponseBindingData({},binding,'local'),emit!:(update:DirectInlineUpdate)=>void,writes=0;
    const io:any={localBindings:()=>responseBindingRequests(records),saveLocalBinding:async()=>{},readNote:async()=>document,updateNote:async()=>document,isOpen:()=>false,openedNotes:()=>[],syncReady:()=>true,knownCompleted:(request:ResponseRequest)=>!!records[request.id]?.completion,access:async()=>{throw Error('No remote work allowed.');},savedResponse:(request:ResponseRequest,text:string)=>savedResponseProof(request,text,records,loadSmartSend(value.settings.smartSend))};
    const manager=new LocalResponseManager('local',binding.vaultId,io,{read:async()=>document,compareAndSet:async()=>{writes++;return false;}},undefined,(_record,_access,receive)=>{emit=receive;return {tick(){},update(){},reconnect(){},delivery(){},suspend(){},dispose(){}} as any;});
    await manager.register(binding);emit({request:binding,messageId:binding.messageId,sequence:1,turnId:'synthetic-exact-turn',body:'Different local rendering',phase:'complete',completionVerified:true});await drain();manager.stopLocally(binding.id);
    document=value.document;manager.changed(binding.notePath);await drain();if(manager.status(binding.id)?.finalSaved)throw Error('Note alone proved completion');records=value.settings.responseBindings;manager.resume();await drain();const result={status:manager.status(binding.id),health:manager.health(),document,writes};manager.dispose();process.stdout.write(JSON.stringify(result));return;
  }
  if(mode==='consume'){const value=JSON.parse(readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(await consume(value.document,value.settings?.responseBindings??{},value.complete===true)));return;}
  if(mode==='merge'){const value=JSON.parse(readFileSync(0,'utf8'));process.stdout.write(JSON.stringify({responseBindings:mergeResponseBindingData(...value.map((settings:any)=>settings?.responseBindings))}));return;}
  const a=request(),b=request(),initial=`Before\n\n${responseAnchor(a.id)}\n\nAfter\n`,second=`Before\n\n${responseAnchor(b.id)}\n\nAfter\n`;
  process.stdout.write(JSON.stringify({initial,second,settingsA:{responseBindings:updateResponseBindingData({},a,'A',1)},settingsB:{responseBindings:updateResponseBindingData({},b,'B',1)}}));
})();
