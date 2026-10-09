import assert from 'node:assert/strict';

export function modelConfig(){return {
  settings:{defaultModelSelection:{instanceId:'codex',model:'gpt-5.6-sol'},defaultRuntimeMode:'full-access',projectSettingsFolded:true,projectSettingsOverrides:{}},
  providers:[{instanceId:'codex',enabled:true,status:'ready',models:[{slug:'automatic-model',isDefault:true}]}],
};}

export function settingsSocket(config:()=>any=modelConfig,onRead:()=>void=()=>{},onRequest?:(tag:string,payload:any)=>any){
  return class {
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:any)=>void;onerror?:()=>void;
    constructor(public url:string){assert.ok(new URL(url).searchParams.get('wsTicket'));assert.equal(new URL(url).searchParams.get('orchestrationProtocol'),'2');queueMicrotask(()=>this.onopen?.());}
    close(){this.onclose?.();}
    send(raw:string){
      const req=JSON.parse(raw);
      queueMicrotask(async()=>{try{
        let value:any;
        if(req.tag==='server.getConfig'){assert.deepEqual(req.payload,{});onRead();value=config();}
        else if(req.tag==='assets.persistChatAttachments')value={attachments:req.payload.attachments.map((a:any,i:number)=>({type:a.type,id:`stored-${req.payload.messageId}-${i}`,name:a.name,mimeType:a.mimeType,sizeBytes:a.sizeBytes}))};
        else {assert.ok(onRequest,`Unexpected RPC ${req.tag}`);value=await onRequest!(req.tag,req.payload);}
        this.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Success',value}})});
      }catch{this.onerror?.();}});
    }
  };
}
