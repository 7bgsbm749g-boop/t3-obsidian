import {test} from 'node:test';
import assert from 'node:assert/strict';
import {htmlRenderFromToolItem,readHtmlRenderReference,readHtmlResult,htmlResultBlocks,htmlResultFrameHeight,renderHtmlResult,type HtmlResultReference} from '../html-results';
import {itemActivities,normalizeV2Snapshot,normalizeV2StreamItem} from '../orchestration-v2';
import {applyThreadItem,renderInlineTurn,inlineBindingCheckpoint,restoreInlineBindings,type InlineThreadState} from '../inline-thread';
import {responseTools} from '../response-tools';
import {streamBlocks} from '../stream-block';
import {reference,tool} from './fixtures/html-result';

test('recognizes T3 HTML across structured, text and provider result wrappers',()=>{
 for(const output of [{htmlRender:reference},JSON.stringify({htmlRender:reference}),{structuredContent:{htmlRender:reference}},{content:[{type:'text',text:JSON.stringify({htmlRender:reference})}]}]){
  assert.equal(htmlRenderFromToolItem(tool(output))?.attachmentId,reference.attachmentId);
 }
 for(const toolName of ['html_render','t3-code.html_render','mcp__t3-code__html_render'])assert.ok(htmlRenderFromToolItem({...tool(),toolName}));
});
test('ignores failed, incomplete, unrelated, malformed and oversized tool results',()=>{
 for(const item of [{...tool(),status:'running'},{...tool(),toolName:'mcp__other__html_render'},{...tool(),type:'command_execution'},tool({isError:true,htmlRender:reference}),tool({content:[{text:JSON.stringify({htmlRender:reference})}],error:{message:'failed'}}),tool('x'.repeat(16_385)),tool({htmlRender:{...reference,height:NaN}})])assert.equal(htmlRenderFromToolItem(item),undefined);
 assert.equal(htmlRenderFromToolItem(tool({content:[{text:JSON.stringify({htmlRender:reference})},{text:JSON.stringify({is_error:true})}]})),undefined);
});
test('reference validation bounds identity, title, sizes and measured widths',()=>{
 assert.equal(readHtmlRenderReference({...reference,title:'\n hello\t',height:20})?.title,'hello');
 assert.equal(readHtmlRenderReference({...reference,height:10_000})?.height,2000);
 for(const update of [{attachmentId:'../secret'},{runId:''},{version:2},{revision:'x\ny'}])assert.equal(readHtmlResult({...reference,...update}),undefined);
 assert.equal(readHtmlRenderReference({...reference,heights:[[0,4]]})?.heights,undefined);
});
test('only top-level complete generated fences become editor widgets',()=>{
 const block=renderHtmlResult(reference),doc='Before\n\n'+block+'\n\nAfter';
 const found=htmlResultBlocks(doc);assert.equal(found.length,1);assert.equal(doc.slice(found[0].from,found[0].to),block);
 for(const example of ['````md\n'+block+'\n````','> '+block.split('\n').join('\n> '),'<pre>\n'+block+'\n</pre>','```t3-html\n'+JSON.stringify(reference),'```t3-html\n{}\n```'])assert.equal(htmlResultBlocks(example).length,0,example);
});
test('sizing follows T3 at narrow widths, dynamic content and deliberate scroll caps',()=>{
 assert.equal(htmlResultFrameHeight(reference,375),500);assert.equal(htmlResultFrameHeight(reference,375,640),640);
 assert.equal(htmlResultFrameHeight({...reference,height:200},375,640),200);
 assert.equal(htmlResultFrameHeight({...reference,heights:undefined},375,640),300);
 assert.equal(htmlResultFrameHeight(reference,375,10_000),2000);
});
function state():InlineThreadState{return {protocolVersion:2,messages:[{id:'answer',itemId:'answer-item',role:'assistant',text:'Final answer',turnId:'run',streaming:false,createdAt:'2026-10-15T15:01:00.000Z'}],activities:itemActivities(tool()),turns:{run:{turnId:'run',state:'completed',completedAt:reference.revision}},latestTurn:{turnId:'run',state:'completed'}};}
test('HTML is a separate result, stays outside tool folds and survives final-only preferences',()=>{
 const current=state();assert.equal(responseTools(current,['run']).length,0);
 for(const mode of ['remove','keep','collapse'] as const)for(const format of ['formatted','raw-markdown'] as const){
  const body=renderInlineTurn(current,'run','thread','complete',mode,'environment',undefined,undefined,undefined,undefined,format);
  assert.equal(htmlResultBlocks(body).length,1,mode);assert.ok(body.indexOf('```t3-html')<body.indexOf('Final answer'));assert.doesNotMatch(body,/send-to-t3-tool-output/);
  if(mode==='collapse')assert.ok(streamBlocks(body)[0].to<body.indexOf('```t3-html'));
 }
 assert.equal(htmlResultBlocks(renderInlineTurn(current,'other-run','thread','complete','remove','environment')).length,0);
});
test('snapshots and live item events give the same HTML result without duplicate tool entries',()=>{
 const snapshot={snapshotSequence:1,projection:{thread:{id:'thread',projectId:'project'},messages:[],runs:[],turnItems:[tool()],runtimeRequests:[]}};
 const normalized=normalizeV2Snapshot(snapshot);let current=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalized}).state;
 current=applyThreadItem(current,normalizeV2StreamItem({kind:'event',sequence:2,event:{type:'turn-item.updated',payload:tool()}})).state;
 assert.equal(current.activities.length,1);assert.equal(current.activities[0].kind,'response.html');
});
test('bounded recovery retains small HTML references; complete snapshots can remove them',()=>{
 const current=state(),checkpoint=inlineBindingCheckpoint(current);
 assert.equal(checkpoint.htmlResults?.length,1);assert.equal('output' in checkpoint.htmlResults![0].payload!,false);
 const partial={snapshotSequence:3,page:{hasMore:true},thread:{protocolVersion:2,messages:[],activities:[]}};
 const reduced=applyThreadItem(current,{kind:'snapshot',snapshot:partial}).state;assert.equal(reduced.activities.length,1);
 const restored=restoreInlineBindings({...reduced,activities:[]},checkpoint);assert.equal(restored.activities.length,1);
 const full=applyThreadItem(restored,{kind:'snapshot',snapshot:{...partial,snapshotSequence:4,page:{hasMore:false}}}).state;assert.equal(full.activities.length,0);
});
