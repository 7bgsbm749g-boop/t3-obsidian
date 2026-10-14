import {randomUUID} from 'node:crypto';
import {contentHash} from '../completion';
import {responseAnchor} from '../native-response-projection';
import {LocalResponseManager} from '../local-response-manager';
import type {HostedInlineRequest} from '../hosted-inline';
import type {DirectInlineUpdate} from '../direct-inline-preview';

const request:HostedInlineRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:'synthetic-sync-lab',host:{environmentId:'synthetic',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Synthetic.md',threadId:randomUUID(),projectId:randomUUID(),messageId:randomUUID(),threadEnvironmentId:'synthetic',initialHash:contentHash(''),createdAt:'2026-10-14T00:00:00Z'};
async function device(initial:string,complete:boolean){
  let document=initial,emit!:(update:DirectInlineUpdate)=>void;
  const io:any={readNote:async()=>document,updateNote:async(_path:string,change:(document:string)=>string)=>document=change(document),saveLocalNote:async()=>{},openedNotes:()=>[{path:request.notePath,document}],isOpen:()=>true,syncReady:()=>true,access:async()=>{throw Error('This replay does not dispatch T3 work.');}};
  const manager=new LocalResponseManager(randomUUID(),request.vaultId,io,{read:async()=>document,compareAndSet:async(_path,before,after)=>{if(document!==before)return false;document=after;return true;}},undefined,(_record,_access,receive)=>{emit=receive;return {tick:()=>{},update:()=>{},delivery:()=>{},suspend:()=>{},dispose:()=>{}} as any;});
  await manager.register(request);
  if(complete){emit({request,messageId:request.messageId,sequence:10,turnId:'synthetic-exact-turn',body:'LOCAL_FINAL_SAVE_LAB_ANSWER',phase:'complete',completionVerified:true});for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));}
  manager.dispose();return document;
}
void (async()=>{const initial=await device(`Before\n\n${responseAnchor(request.id)}\n\nAfter\n`,false),a=await device(initial,true),b=await device(initial,true);if(a!==b)throw Error('Independent final saves differ.');process.stdout.write(JSON.stringify({initial,a,b,bEdited:b.replace('After','After with an independent edit')}));})();
