import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {renderInlineTurn,initialRegion,type InlineThreadState} from '../inline-thread';
import {finalAnswerFormat,type IntermediateMode} from '../response-presentation';
import {validateResponseRequest,responseRequestHash,type ResponseRequest} from '../response-model';
import {rewriteReplyReferences} from '../reply-assets';

const state:InlineThreadState={messages:[
  {id:'progress',role:'assistant',turnId:'turn',text:'Checking the result.\n\nA second paragraph.',streaming:false,createdAt:'2026-10-02T10:00:00Z'},
  {id:'final',role:'assistant',turnId:'turn',text:'Final answer.\n\n- First\n  - Nested\n\n    indented code\n\n| File | Image |\n| --- | --- |\n| [report](/tmp/report.txt) | ![plot](/tmp/plot.png) |\n\n<placeholder>\n\n```md\n![example](/tmp/example.png)\n```',streaming:false,createdAt:'2026-10-02T10:01:00Z'},
  {id:'recovered',role:'assistant',turnId:'turn',text:'Recovered progress.',streaming:false,createdAt:'2026-10-02T10:00:30Z'},
],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final',completedAt:'2026-10-02T10:02:00Z'}};
const render=(value=state,mode:IntermediateMode='keep',phase:'complete'|'running'|'error'='complete',conversation?:any)=>renderInlineTurn(value,'turn','thread',phase,mode,'environment',conversation,undefined,undefined,{startedAt:'2026-10-02T10:00:00Z'},'raw-markdown');

for(const mode of ['remove','keep','collapse'] as const)test(`raw final preserves Markdown and ${mode} progress independently`,()=>{
  const text=render(state,mode);
  assert.match(text,/(?:^|\n)Final answer\.\n\n- First\n  - Nested\n\n    indented code/);
  assert.match(text,/\\<placeholder>/);assert.match(text,/```md\n!\[example\]\(\/tmp\/example.png\)\n```/);
  assert.doesNotMatch(text,/> Final answer/);
  if(mode==='remove')assert.doesNotMatch(text,/Checking|Recovered/);
  else assert.match(text,mode==='collapse'?/> > Checking the result\./:/> Checking the result\./);
  const ast=unified().use(remarkParse).parse(text+'\nFollowing user paragraph.');
  for(const node of ast.children.filter(node=>node.type==='blockquote')){
    const block=text.slice(node.position!.start.offset!,node.position!.end.offset!);
    assert.doesNotMatch(block,/Final answer|Following user paragraph/);
  }
});

for(const mode of ['remove','keep','collapse'] as const)test(`${mode} live progress and failure remain byte-identical in both formats`,()=>{
  for(const phase of ['running','error'] as const){
    const live={...state,latestTurn:{...state.latestTurn!,state:phase},session:{status:phase,activeTurnId:phase==='running'?'turn':null,lastError:'Provider failed'}};
    assert.equal(render(live,mode,phase),renderInlineTurn(live,'turn','thread',phase,mode,'environment',undefined,undefined,undefined,{startedAt:'2026-10-02T10:00:00Z'}));
  }
});

test('raw final selection uses completion bounds rather than recovered message arrival order',()=>{
  const stale={...state,latestTurn:{...state.latestTurn!,assistantMessageId:'progress'}};
  assert.match(render(stale,'remove'),/^Final answer/);
  const late={...stale,messages:[...stale.messages,{...state.messages[1],id:'late',text:'Unverified late answer',createdAt:'2026-10-02T10:03:00Z'}]};
  assert.match(render(late,'remove'),/^Final answer/);assert.doesNotMatch(render(late,'remove'),/Unverified/);
});

test('earlier final joins collapsed history while expanded raw history and question controls remain supported',()=>{
  const current:InlineThreadState={...state,messages:[...state.messages,{id:'next-progress',role:'assistant',turnId:'next',text:'Follow-up progress.\n\n```ts\npartial',streaming:true}],turns:{turn:state.latestTurn!},latestTurn:{turnId:'next',state:'running'},session:{status:'running',activeTurnId:'next'},activities:[{id:'q',kind:'user-input.requested',turnId:'next',summary:'Question',payload:{requestId:'question',responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Proceed?',options:[{label:'Yes',description:'Continue'}]}]}}]};
  const conversation={messages:current.messages,steering:[{messageId:'input',text:'Please continue.',before:state.messages,confirmed:true}],preserveHistory:true};
  for(const mode of ['keep','collapse'] as const){
    const text=renderInlineTurn(current,'next','thread','running',mode,'environment',conversation,undefined,undefined,undefined,'raw-markdown');
    assert.match(text,mode==='collapse'?/> > Final answer\.\n/:/\nFinal answer\.\n/);
    assert.match(text,mode==='collapse'?/> > \[!t3-steering\] You\n> > Please continue\./:/> \[!t3-steering\] You\n> Please continue\./);
    assert.match(text,mode==='collapse'?/> > Follow-up progress/:/> Follow-up progress/);
    assert.match(text,/Proceed\?|t3-question:/);assert.match(text,/send-to-t3-response-activity/);
    assert.match(text,/stream-tail">```ts&#10;partial<\/span>/);
  }
});

test('raw final imports files and images in place with table escaping and code examples untouched',async()=>{
  const sources:string[]=[];
  const rewritten=await rewriteReplyReferences(state.messages[1].text,async reference=>{sources.push(reference.source);return `${reference.image?'!':''}[[Attachments/${reference.source.split('/').at(-1)}|${reference.label}]]`;});
  const text=render({...state,messages:state.messages.map(message=>message.id==='final'?{...message,text:rewritten}:message)},'collapse');
  assert.deepEqual(sources,['/tmp/report.txt','/tmp/plot.png']);
  assert.match(text,/\| \[\[Attachments\/report.txt\\\|report\]\] \| !\[\[Attachments\/plot.png\\\|plot\]\] \|/);
  assert.match(text,/!\[example\]\(\/tmp\/example.png\)/);assert.match(text,/\nFinal answer\.\n/);
});

test('legacy requests keep exact bytes and hashes; raw jobs require the new writer version',()=>{
  const request:ResponseRequest={version:2,id:randomUUID(),initialOwner:randomUUID(),vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:'Note.md',threadId:randomUUID(),messageId:randomUUID(),projectId:'project',threadEnvironmentId:'host',initialHash:initialRegion(randomUUID()).bodyHash,createdAt:'2026-10-02T10:00:00Z'};
  const bytes=JSON.stringify(request),hash=responseRequestHash(request);
  assert.equal(finalAnswerFormat(undefined),'formatted');assert.equal(finalAnswerFormat('unknown'),'formatted');
  validateResponseRequest(request);finalAnswerFormat(request.finalAnswerFormat);
  assert.equal(JSON.stringify(request),bytes);assert.equal(responseRequestHash(request),hash);
  assert.throws(()=>validateResponseRequest({...request,finalAnswerFormat:'raw-markdown'}),/updated response writer/);
  assert.throws(()=>validateResponseRequest({...request,version:3,finalAnswerFormat:'invalid'}),/final answer format/);
  assert.equal(validateResponseRequest({...request,version:3,finalAnswerFormat:'raw-markdown'}).finalAnswerFormat,'raw-markdown');
});
