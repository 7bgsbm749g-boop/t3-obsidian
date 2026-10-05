import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {importReplyAsset} from '../hosted-inline-desktop';
import {assetSource} from '../reply-import';
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
    ]);
  }finally{globalThis.WebSocket=priorSocket;globalThis.fetch=priorFetch;}
});

function assetVault(){
  const saved=new Map<string,Uint8Array>(),folders=new Set<string>();
  const app:any={metadataCache:{getFirstLinkpathDest:()=>null},fileManager:{generateMarkdownLink:(file:any,note:string,_sub:any,label:string)=>`[[${file.path}${label?`|${label}`:''}]]`},vault:{
    getAbstractFileByPath:(path:string)=>folders.has(path)?{path}:saved.has(path)?{path}:null,
    getFileByPath:(path:string)=>saved.has(path)?{path}:null,
    createFolder:async(path:string)=>{if(folders.has(path))throw Error('Exists');folders.add(path);},
    createBinary:async(path:string,data:ArrayBuffer)=>{assert.equal(saved.has(path),false);saved.set(path,new Uint8Array(data));return {path};},
    readBinary:async(file:any)=>saved.get(file.path)!.buffer,
  }};
  return {app,saved,folders};
}
test('attachment sources include sandbox, file URLs, percent encoding and line-number links',()=>{
  assert.equal(assetSource('sandbox:/mnt/data/chart.png'),'/mnt/data/chart.png');
  assert.equal(assetSource('/workspace/main.ts:123:4'),'/workspace/main.ts');
  assert.equal(assetSource('file:///tmp/my%20report.pdf'),'/tmp/my report.pdf');
  assert.equal(assetSource('report%20one.pdf#page=2'),'report one.pdf');
  assert.equal(assetSource('C:\\Project\\report.pdf'),'C:\\Project\\report.pdf');
  for(const source of ['https://example.com/a.png','data:image/png;base64,x','t3-context://image/x','obsidian://note.md','#section','//host/share/file.pdf'])assert.equal(assetSource(source),undefined);
  assert.throws(()=>assetSource('bad%file.txt'),/percent encoding/);
});
test('binary documents and linked images use their chosen folders; concurrent mirrors and retries reuse one copy',async()=>{
  const {app,saved}=assetVault(),bytes=Uint8Array.from([80,75,0,255,128]);let reads=0;
  const request={id:randomUUID(),threadId:randomUUID(),messageId:randomUUID(),projectId:'project',notePath:'Elsewhere/mirror.md',replyFolders:{images:'Project/Images/T3',files:'Project/Documents/T3'}} as HostedInlineRequest;
  const access={origin:'https://t3.example',api:async()=>assert.fail('Local file reader must preserve binary bytes'),readReplyFile:async(source:string,projectId:string)=>{reads++;assert.equal(projectId,'project');return bytes;}};
  const ref={source:'/workspace/report.zip',original:'[report](/workspace/report.zip)',image:false,label:'report',offset:0};
  const [a,b]=await Promise.all([importReplyAsset(app,ref,request,access),importReplyAsset(app,{...ref,label:'mirror'},{...request,id:randomUUID(),notePath:'Another/mirror.md'},access)]);
  assert.match(a!,/^\[\[Project\/Documents\/T3\//);assert.match(b!,/\|mirror\]\]$/);
  assert.equal(reads,1);assert.equal(saved.size,1);assert.deepEqual([...saved.values()][0],bytes);
  assert.equal(await importReplyAsset(app,ref,{...request,id:randomUUID()},access),a);assert.equal(reads,1);
  const image=await importReplyAsset(app,{...ref,source:'/workspace/chart.png',image:false},request,access);
  assert.match(image!,/^\[\[Project\/Images\/T3\//);assert.equal(saved.size,2);
});
test('absolute vault references link existing files without downloading or copying them',async()=>{
  const {app,saved}=assetVault();saved.set('Notes/my note.md',new TextEncoder().encode('Existing note'));
  app.metadataCache.getFirstLinkpathDest=()=>assert.fail('Absolute paths must not resolve a coincidental vault basename');
  const request={id:randomUUID(),notePath:'Notes/reply.md',host:{workspaceRoot:'/vault'}} as HostedInlineRequest;
  const access={origin:'https://t3.example',api:async()=>assert.fail('Existing vault files need no T3 request')};
  const link=await importReplyAsset(app,{source:'/vault/Notes/my%20note.md',original:'',label:'note',image:false,offset:0},request,access);
  assert.equal(link,'[[Notes/my note.md|note]]');assert.equal(saved.size,1);
});
test('a failed import creates no folders and retries successfully; empty documents are retained',async()=>{
  const {app,saved,folders}=assetVault();let fail=true;
  const request={id:randomUUID(),threadId:'thread',projectId:'project',notePath:'Notes/reply.md'} as HostedInlineRequest;
  const access={origin:'https://t3.example',api:async()=>({}),readReplyFile:async()=>{if(fail)throw Error('Missing file');return new Uint8Array();}};
  const ref={source:'report.txt',original:'',label:'report',image:false,offset:0};
  await assert.rejects(importReplyAsset(app,ref,request,access),/Missing/);assert.equal(folders.size,0);assert.equal(saved.size,0);
  fail=false;assert.match((await importReplyAsset(app,ref,request,access))!,/report\.txt/);assert.equal([...saved.values()][0].length,0);
});
test('remote binary files never pass through the UTF-8 project reader',async()=>{
  const {app,saved}=assetVault(),prior=globalThis.WebSocket;const calls:string[]=[];
  class Socket {
    onopen?:()=>void;onmessage?:(event:{data:string})=>void;onclose?:()=>void;
    constructor(_url:string){queueMicrotask(()=>this.onopen?.());}
    send(raw:string){const frame=JSON.parse(raw);calls.push(frame.tag);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:frame.id,exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'AssetPreviewTypeValidationError'}}]}})}));}
    close(){this.onclose?.();}
  }
  (globalThis as any).WebSocket=Socket;
  try{
    const request={id:randomUUID(),threadId:'thread',projectId:'project',notePath:'reply.md'} as HostedInlineRequest;
    await assert.rejects(importReplyAsset(app,{source:'report.zip',original:'',label:'report',image:false,offset:0},request,{origin:'https://t3.example',api:async()=>({ticket:'ticket'})}),/remote computer/);
    assert.deepEqual(calls,['assets.createUrl']);assert.equal(saved.size,0);
  }finally{globalThis.WebSocket=prior;}
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
