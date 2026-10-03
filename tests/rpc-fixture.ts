import assert from 'node:assert/strict';

export function modelConfig(){return {
  settings:{defaultModelSelection:{instanceId:'codex',model:'gpt-5.6-sol'},defaultRuntimeMode:'full-access',projectSettingsFolded:true,projectSettingsOverrides:{}},
  providers:[{instanceId:'codex',enabled:true,status:'ready',models:[{slug:'automatic-model',isDefault:true}]}],
};}

export function settingsSocket(config:()=>any=modelConfig,onRead:()=>void=()=>{}){
  return class {
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:any)=>void;
    constructor(public url:string){assert.ok(new URL(url).searchParams.get('wsTicket'));queueMicrotask(()=>this.onopen?.());}
    close(){this.onclose?.();}
    send(raw:string){
      const req=JSON.parse(raw);assert.equal(req.tag,'server.getConfig');assert.deepEqual(req.payload,{});onRead();
      const value=config();
      queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Success',value}})}));
    }
  };
}
