import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {toolImageSources,parseImageResult,renderImageResult,responseImageResults,type ImageResultReference} from '../src/responses/image-results';
import {itemActivities,normalizeV2Snapshot,normalizeV2StreamItem} from '../src/connection/orchestration-v2';
import {applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,renderInlineTurn,type InlineThreadState} from '../src/conversations/inline-thread';
import {streamBlocks} from '../src/responses/stream-block';
import {responseToolGroups} from '../src/responses/response-tools';

const at='2026-11-16T07:09:00.000Z';
const image={type:'image',mimeType:'image/png',data:'private-base64-payload'};
const tool=(overrides:any={})=>({id:'image-tool',threadId:'thread',runId:'run',type:'dynamic_tool',toolName:'view_image',status:'completed',ordinal:2,updatedAt:at,startedAt:at,input:{path:'/evidence/capture.png'},...overrides});
const reference:ImageResultReference={version:1,environmentId:'env',threadId:'thread',runId:'run',itemId:'image-tool',revision:at,source:{kind:'file',path:'/evidence/capture.png'}};
function state():InlineThreadState{return {protocolVersion:2,messages:[{id:'before',role:'assistant',text:'Checking the screen.',turnId:'run',streaming:false,createdAt:'2026-11-16T07:08:00.000Z'},{id:'after',role:'assistant',text:'I found the problem.',turnId:'run',streaming:false,createdAt:'2026-11-16T07:10:00.000Z'}],activities:itemActivities(tool()),latestTurn:{turnId:'run',state:'running'},session:{status:'running',activeTurnId:'run'}};}
test('uses the viewed file or bounded tool image indexes without retaining image bytes',()=>{
 assert.deepEqual(toolImageSources(tool()),[reference.source]);
 assert.deepEqual(toolImageSources(tool({viewedImagePath:'/other/actual.png'})),[{kind:'file',path:'/other/actual.png'}]);
 assert.deepEqual(toolImageSources(tool({input:JSON.stringify(tool().input)})),[reference.source]);
 for(const output of [[image],{content:[{type:'text',text:'caption'},image],structuredContent:{ok:true}},image]){
  assert.deepEqual(toolImageSources(tool({output})),[{kind:'output',index:0,mimeType:'image/png'}]);
  assert.doesNotMatch(JSON.stringify(itemActivities(tool({output}))),/private-base64/);
  assert.doesNotMatch(JSON.stringify(inlineBindingCheckpoint({...state(),activities:itemActivities(tool({output}))})),/private-base64|data:/);
 }
 assert.deepEqual(toolImageSources(tool({output:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'abc'}}]})),[{kind:'output',index:0,mimeType:'image/jpeg'}]);
 assert.equal(toolImageSources(tool({output:Array.from({length:10},()=>image)})).length,8);
 assert.deepEqual(toolImageSources(tool({output:{isError:true,content:[image]}})),[]);
 for(const overrides of [{status:'running'},{status:'failed'},{type:'command_execution'},{toolName:'other',input:{path:'/secret.png'}},{input:{path:'/secret.svg'}},{input:{path:'/a\nb.png'}},{input:undefined,output:[{type:'image',mimeType:'image/svg+xml',data:'x'}]}])assert.deepEqual(toolImageSources(tool(overrides)),[]);
});
test('streamed images sit between progress messages inside the native fold and survive completion',()=>{
 const current=state();
 for(const phase of ['running','complete','interrupted','cancelled'] as const){
  const body=renderInlineTurn(current,'run','thread',phase,'collapse','env');
  assert.ok(body.indexOf('Checking the screen.')<body.indexOf('```t3-image'));
  assert.ok(body.indexOf('```t3-image')<body.indexOf('I found the problem.'));
  assert.equal((body.match(/```t3-image/g)??[]).length,1);
  const fold=streamBlocks(body)[0];assert.ok(fold.text.includes('```t3-image'));
  const root=unified().use(remarkParse).parse(body);const quote=root.children[0];
  assert.equal(quote.type,'blockquote');
  if(quote.type==='blockquote')assert.ok(quote.children.some(node=>node.type==='code'&&node.lang==='t3-image'));
 }
 assert.doesNotMatch(renderInlineTurn(current,'different-run','thread','running','collapse','env'),/```t3-image/);
 for(const mode of ['keep','remove'] as const){
  const body=renderInlineTurn(current,'run','thread','running',mode,'env');
  assert.ok(body.indexOf('Checking the screen.')<body.indexOf('```t3-image'));
  assert.ok(body.indexOf('```t3-image')<body.indexOf('I found the problem.'));
  assert.match(renderInlineTurn(current,'run','thread','complete',mode,'env'),/```t3-image/);
 }
 const after=itemActivities(tool({id:'next-tool',ordinal:3,toolName:'run',input:{},startedAt:'2026-11-16T07:09:30.000Z'}));
 assert.equal(responseToolGroups({...current,activities:[...current.activities,...after]},['run']).length,2,'The next command must stay after the image');
});
test('snapshot, live event and reconnect recovery deduplicate the same image reference',()=>{
 const snapshot=normalizeV2Snapshot({snapshotSequence:1,hasMoreHistory:true,projection:{thread:{id:'thread',projectId:'project'},messages:[],runs:[],turnItems:[tool()],runtimeRequests:[]}});
 let current=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
 const event=(value:any,sequence:number)=>normalizeV2StreamItem({kind:'event',sequence,event:{type:'turn-item.updated',payload:value}});
 current=applyThreadItem(current,event(tool(),2)).state;
 assert.equal(current.activities.filter(item=>item.kind==='response.image').length,1);
 const saved=inlineBindingCheckpoint(current);assert.equal(saved.imageResults?.length,1);
 const partial={snapshotSequence:3,page:{hasMore:true},thread:{protocolVersion:2 as const,messages:[],activities:[]}};
 current=applyThreadItem(current,{kind:'snapshot',snapshot:partial}).state;
 assert.equal(current.activities.length,1);
 current=restoreInlineBindings({...current,activities:[]},saved);
 assert.equal(current.activities.length,1);
 current=applyThreadItem(current,event(tool({status:'failed'}),4)).state;
 assert.equal(current.activities.filter(item=>item.kind==='response.image').length,0);
 assert.equal(restoreInlineBindings(current,saved).activities.filter(item=>item.kind==='response.image').length,0,'Recovery must not restore an image superseded by canonical failure');
 const failed=applyThreadItem({...state(),sequence:2},{kind:'snapshot',snapshot:{...partial,thread:{...partial.thread,activities:itemActivities(tool({status:'failed'}))}}}).state;
 assert.equal(failed.activities.filter(item=>item.kind==='response.image').length,0);
 const full=applyThreadItem(restoreInlineBindings({...current,activities:[]},saved),{kind:'snapshot',snapshot:{...partial,snapshotSequence:5,page:{hasMore:false}}}).state;
 assert.equal(full.activities.length,0);
});
test('saved references are small, strict, and contain no signed URLs or image payloads',()=>{
 const activity=itemActivities(tool()).find(item=>item.kind==='response.image')!;
 assert.deepEqual(responseImageResults(activity,'env','thread'),[reference]);
 assert.deepEqual(parseImageResult(renderImageResult(reference).split('\n')[1]),reference);
 for(const change of [{version:2},{runId:''},{itemId:'x\ny'},{source:{kind:'url',url:'https://evil.example'}},{source:{kind:'output',index:8,mimeType:'image/png'}},{source:{kind:'output',index:0,mimeType:'text/html'}}])assert.equal(parseImageResult(JSON.stringify({...reference,...change})),undefined);
 assert.equal(parseImageResult('x'.repeat(8193)),undefined);
});

test('partial snapshots with omitted historical output keep an already known image',()=>{
 const imageTool=tool({toolName:'screenshot',input:{},output:[image]});
 const current={...state(),activities:itemActivities(imageTool),sequence:1};
 const partial={snapshotSequence:2,page:{hasMore:true},thread:{protocolVersion:2 as const,messages:[],activities:itemActivities({...imageTool,output:undefined,outputOmitted:true})}};
 const next=applyThreadItem(current,{kind:'snapshot',snapshot:partial}).state;
 assert.equal(next.activities.filter(item=>item.kind==='response.image').length,1);
 assert.equal(restoreInlineBindings({...next,activities:partial.thread.activities},inlineBindingCheckpoint(current)).activities.filter(item=>item.kind==='response.image').length,1);
});
