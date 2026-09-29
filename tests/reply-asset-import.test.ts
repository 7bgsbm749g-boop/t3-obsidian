import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {importReplyAsset} from '../hosted-inline-desktop';
import type {HostedInlineRequest} from '../hosted-inline';

test('signed T3 image is copied once into the vault and linked from the note',async()=>{
  const id=randomUUID(),saved=new Map<string,Uint8Array>(),folders=new Set<string>();
  const request={id,threadId:randomUUID(),notePath:'Notes/answer.md'} as HostedInlineRequest;
  const app:any={
    metadataCache:{getFirstLinkpathDest:()=>null},
    fileManager:{generateMarkdownLink:(file:any,_note:string,_sub:any,label:string)=>`[[${file.path}${label?`|${label}`:''}]]`},
    vault:{getAbstractFileByPath:(path:string)=>folders.has(path)?{path}:saved.has(path)?{path}:null,
      getFileByPath:(path:string)=>saved.has(path)?{path}:null,
      createFolder:async(path:string)=>{folders.add(path);},
      createBinary:async(path:string,data:ArrayBuffer)=>{assert.equal(saved.has(path),false);saved.set(path,new Uint8Array(data));return {path};},
      readBinary:async(file:any)=>saved.get(file.path)!.buffer,
    },
  };
  const priorSocket=globalThis.WebSocket,priorFetch=globalThis.fetch;
  const calls:any[]=[];
  class Socket {
    onopen?:()=>void;onmessage?:(event:{data:string})=>void;onclose?:()=>void;
    constructor(public url:string){queueMicrotask(()=>this.onopen?.());}
    send(raw:string){const frame=JSON.parse(raw);calls.push(frame);if(frame.tag==='assets.createUrl')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:frame.id,exit:{_tag:'Success',value:{relativeUrl:'/api/assets/signed/plot.png'}}})}));}
    close(){this.onclose?.();}
  }
  (globalThis as any).WebSocket=Socket;
  globalThis.fetch=async url=>{assert.equal(String(url),'https://t3.example/api/assets/signed/plot.png');return new Response(Uint8Array.from([137,80,78,71]));};
  try{
    const access={origin:'https://t3.example',api:async()=>({ticket:'ticket'})};
    const reference={source:'/tmp/plot.png',original:'![plot](/tmp/plot.png)',label:'plot',image:true,offset:0};
    const first=await importReplyAsset(app,reference,request,access);
    assert.match(first!,/^!\[\[T3 Code Attachments\//);
    assert.match(first!,/plot\.png\|plot\]\]$/);
    assert.equal(saved.size,1);
    assert.equal(await importReplyAsset(app,reference,request,access),first);
    assert.equal(saved.size,1);
    assert.deepEqual(calls.filter(call=>call.tag==='assets.createUrl').map(call=>call.payload.resource),[
      {_tag:'media-file',threadId:request.threadId,path:'/tmp/plot.png'},
      {_tag:'media-file',threadId:request.threadId,path:'/tmp/plot.png'},
    ]);
  }finally{globalThis.WebSocket=priorSocket;globalThis.fetch=priorFetch;}
});

test('plain text links use the project file reader when T3 media serving refuses the type',async()=>{
  const id=randomUUID(),saved=new Map<string,Uint8Array>(),folders=new Set<string>();
  const request={id,threadId:randomUUID(),projectId:'project',notePath:'Notes/answer.md'} as HostedInlineRequest;
  const app:any={metadataCache:{getFirstLinkpathDest:()=>null},fileManager:{generateMarkdownLink:(file:any)=>`[[${file.path}]]`},vault:{
    getAbstractFileByPath:(path:string)=>folders.has(path)?{path}:null,getFileByPath:(path:string)=>saved.has(path)?{path}:null,
    createFolder:async(path:string)=>{folders.add(path);},createBinary:async(path:string,data:ArrayBuffer)=>{saved.set(path,new Uint8Array(data));return {path};},readBinary:async()=>assert.fail('no existing file'),
  }};
  const priorSocket=globalThis.WebSocket;
  class Socket {
    onopen?:()=>void;onmessage?:(event:{data:string})=>void;onclose?:()=>void;
    constructor(_url:string){queueMicrotask(()=>this.onopen?.());}
    send(raw:string){const frame=JSON.parse(raw);if(!frame.tag)return;const exit=frame.tag==='assets.createUrl'?{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'AssetPreviewTypeValidationError'}}]}:{_tag:'Success',value:{relativePath:'report.txt',contents:'Report contents',byteLength:15,truncated:false}};queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:frame.id,exit})}));}
    close(){this.onclose?.();}
  }
  (globalThis as any).WebSocket=Socket;
  try{
    const access={origin:'https://t3.example',api:async(path:string)=>path.includes('ticket')?{ticket:'ticket'}:{projects:[{id:'project',workspaceRoot:'/workspace'}]}};
    const link=await importReplyAsset(app,{source:'report.txt',original:'[report](report.txt)',label:'report',image:false,offset:0},request,access);
    assert.match(link!,/^\[\[T3 Code Attachments\//);
    assert.equal(new TextDecoder().decode([...saved.values()][0]),'Report contents');
  }finally{globalThis.WebSocket=priorSocket;}
});
