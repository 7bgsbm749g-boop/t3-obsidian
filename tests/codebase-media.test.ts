import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeMediaSource,originalMediaSource,originalLinkAt,codebaseMediaExtension,mediaSourceCacheStatus} from '../src/projects/codebase-media';

test('Live Preview file links retain the exact target even when labels repeat',()=>{
  const line='> [report](C:/Users/Public/Documents/report.md) and [report](/other/report.md)';
  assert.equal(originalLinkAt(line,line.indexOf('report')),'C:/Users/Public/Documents/report.md');
  assert.equal(originalLinkAt(line,line.lastIndexOf('[report]')+1),'/other/report.md');
  assert.equal(originalLinkAt(line,0),undefined);assert.equal(originalLinkAt('![image](/image.png)',3),undefined);
});

test('native span gestures route both early mousedown and click from the editor source range',()=>{
  const handlers=new Map<string,(event:any)=>void>(),calls:any[]=[];
  class Observer{observe(){}disconnect(){}}
  const line='> Created [report](C:/Users/Public/Documents/report.md).';
  const view:any={dom:{ownerDocument:{defaultView:{MutationObserver:Observer}},addEventListener:(name:string,handler:any)=>handlers.set(name,handler),removeEventListener:(name:string)=>handlers.delete(name)},contentDOM:{},state:{field:()=>({file:{path:'Reply.md'}}),doc:{lineAt:()=>({from:20,text:line})}},posAtDOM:()=>20+line.indexOf('report')};
  const instance=(codebaseMediaExtension({} as any,async()=>{},(link,source,event)=>{calls.push({link,source,type:event.type});event.preventDefault();}) as any).create(view);
  const span={closest:(selector:string)=>selector==='.cm-link'?span:null};
  for(const type of ['mousedown','click']){let prevented=false;handlers.get(type)!({type,button:0,target:span,preventDefault(){prevented=true;}});assert.equal(prevented,true);}
  assert.deepEqual(calls.map(call=>call.type),['mousedown','click']);assert.ok(calls.every(call=>call.link==='C:/Users/Public/Documents/report.md'&&call.source==='Reply.md'));
  handlers.get('mousedown')!({button:2,target:span});assert.equal(calls.length,2);instance.destroy();assert.equal(handlers.size,0);
});

test('native image paths resolve on desktop, iOS and Android without treating web images as local files',()=>{
  for(const value of ['app://obsidian.md/home/ubuntu/project/chart.png','capacitor://localhost/_capacitor_file_/home/ubuntu/project/chart.png','http://localhost/_app_file_/home/ubuntu/project/chart.png','https://localhost/_capacitor_file_/home/ubuntu/project/chart.png'])assert.equal(nativeMediaSource(value)?.link,'/home/ubuntu/project/chart.png');
  assert.equal(nativeMediaSource('capacitor://localhost/_capacitor_file_/home/ubuntu/project/a%20b.png#size')?.link,'/home/ubuntu/project/a b.png#size');
  assert.deepEqual(nativeMediaSource('capacitor://localhost/_capacitor_file_/private/vault/Assets/chart.png','capacitor://localhost/_capacitor_file_/private/vault'),{link:'Assets/chart.png',vaultRelative:'Assets/chart.png'});
  assert.equal(nativeMediaSource('https://example.com/_app_file_/home/ubuntu/chart.png'),undefined);
  assert.equal(nativeMediaSource('https://images.example.com/chart.png'),undefined);
  assert.equal(nativeMediaSource('data:image/png;base64,AA=='),undefined);
  assert.equal(nativeMediaSource('app://obsidian.md/%ZZ'),undefined);
});

test('an image without a native src can recover its exact Markdown reference from its rendered section',()=>{
  const text='![other](/other.png)\n\n> ![chart](/machine/chart.png)\n';
  assert.equal(originalMediaSource(text,'chart',{lineStart:2,lineEnd:2}),'/machine/chart.png');
  assert.equal(originalMediaSource('![chart](/a.png) ![chart](/b.png)','chart'),undefined);
  assert.equal(originalMediaSource('x'.repeat(8193),'chart'),undefined);
});

test('Live Preview scans are coalesced and observe only the current editor until it is destroyed',async()=>{
  let observed:any,options:any,disconnected=false,notify!:()=>void,renders=0,source='Note.md',current!:()=>boolean;
  class Observer{constructor(callback:()=>void){notify=callback;}observe(root:any,value:any){observed=root;options=value;}disconnect(){disconnected=true;}}
  const state:any={field:()=>({file:{path:source}}),doc:{lineAt:()=>({text:'![chart](/machine/chart.png)'})}},root={},view:any={dom:{ownerDocument:{defaultView:{MutationObserver:Observer}}},contentDOM:root,state,posAtDOM:()=>0};
  const extension:any=codebaseMediaExtension({} as any,async(element,path,original,valid)=>{renders++;assert.equal(element,root);assert.equal(path,'Note.md');assert.equal(original({getAttribute:()=> 'chart'} as any),'/machine/chart.png');current=valid;});
  const instance=extension.create(view);for(let i=0;i<100;i++)notify();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(renders,1);assert.equal(observed,root);assert.equal(options.subtree,true);assert.deepEqual(options.attributeFilter,['src']);assert.equal(current(),true);
  source='Other.md';assert.equal(current(),false);source='Note.md';notify();instance.destroy();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(renders,1);assert.equal(disconnected,true);assert.equal(current(),false);
});

test('a slow media request retains only one active scan and one pending rescan per editor',async()=>{
  let notify!:()=>void,finish!:()=>void,renders=0;
  class Observer{constructor(callback:()=>void){notify=callback;}observe(){}disconnect(){}}
  const view:any={dom:{ownerDocument:{defaultView:{MutationObserver:Observer}}},contentDOM:{},state:{field:()=>({file:{path:'Note.md'}}),doc:{}}};
  const extension:any=codebaseMediaExtension({} as any,async()=>{renders++;if(renders===1)await new Promise<void>(resolve=>{finish=resolve;});}),instance=extension.create(view);
  await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<100;i++)notify();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(renders,1);
  finish();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(renders,2);
  (notify as any)([{type:'attributes',target:{getAttribute:()=> 'https://t3.example/api/assets/signed'}}]);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(renders,2,'The signed URL assigned by the bridge must not schedule another resource fill');instance.destroy();
});

test('repeated native media scans reuse bounded section parses and retain exact changed sources',()=>{
 const markdown='![chart](/first.png) ![other](/other.png)';assert.equal(originalMediaSource(markdown,'chart'),'/first.png');
 const before=mediaSourceCacheStatus();
 for(let i=0;i<100;i++){assert.equal(originalMediaSource(markdown,'chart'),'/first.png');assert.equal(originalMediaSource(markdown,'other'),'/other.png');}
 assert.equal(mediaSourceCacheStatus().sourceParses,before.sourceParses);
 assert.equal(originalMediaSource(markdown.replace('first','changed'),'chart'),'/changed.png');
 for(let i=0;i<150;i++)originalMediaSource('![chart](/'+i+'.png)','chart');
 const status=mediaSourceCacheStatus();assert.ok(status.entries<=128);assert.ok(status.characters<=status.maxCharacters);
 assert.equal(originalMediaSource(markdown,'chart'),'/first.png');
});
