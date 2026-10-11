import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import type {StateField} from '@codemirror/state';
import type {DecorationSet} from '@codemirror/view';
import {responseAnchor,renderResponse,projectResponses,savedProjection,responseRegion} from '../native-response-projection';
import {containerBody,containerStart,containerEnd,responseFrame,responseIds,responseBoundaries} from '../response-container';
import {regionBody,inlineTargetAt,inlineResponseRange,activeInlineIds,initialRegion,finalizeRegion,startMarker,endMarker} from '../inline-thread';
import {contentHash} from '../completion';
import {eventContent} from '../event-subscriptions';
import {editorStream} from '../editor-stream';
import {ResponseNoteLocator} from '../response-location';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {renderQuestion,clearResolvedQuestion,removeDismissedQuestions} from '../questions';
import {renderApproval,clearApprovalControls} from '../approvals';
import {historyFixture} from './fixtures/stream-history';
import {streamBlock,removeStreamBlock} from '../stream-block';
import {restoreResponseAnchor} from '../response-anchor-recovery';
import {validateFinalResponseBody} from '../generated-note-coordinator';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='11111111-2222-4333-8444-555555555555';
const legacy=(id:string)=>`${startMarker(id)}\n\n${endMarker(id)}`;
test('mixed active containers and legacy anchors keep exact saved bytes and route independently',()=>{
  const saved='Before\n'+responseAnchor(id)+'\nMiddle\n'+legacy(other)+'\nAfter';
  const projection=projectResponses(saved,[{id,body:'**Container · Working**\n\n> Live'},{id:other,body:'**Legacy · Working**\n\n> Old'}]);
  assert.equal(savedProjection(projection.display,projection),saved);
  assert.deepEqual(activeInlineIds(projection.display),[id,other]);
  for(const uuid of [id,other]){const region=regionBody(projection.display,uuid)!;assert.equal(inlineTargetAt(projection.display,region.from),uuid);const range=inlineResponseRange(projection.display,uuid)!;assert.ok(range.from<region.from&&range.to>region.to);}
  assert.equal(responseAnchor(other,saved),legacy(other));
});
test('complete container encloses progress, final answer and controls while history stays independently bounded',()=>{
  const {body,key}=historyFixture(),document=containerBody(id,body+'\n\nAction needed');
  const frame=responseFrame(document,id)!;assert.equal(frame.body,body+'\n\nAction needed');
  const history=streamBlock(document,key)!;assert.equal(history.tracked,true);assert.ok(history.to<document.indexOf('Final answer stays.'));
  assert.throws(()=>removeStreamBlock(document,key),/changed/);
  const final=finalizeRegion(document,id,contentHash(frame.body),body)!;
  const finished=document.slice(0,final.from)+final.text+document.slice(final.to);
  assert.equal(responseIds(finished).length,0);assert.ok(removeStreamBlock(finished,key).text.includes('Final answer stays.'));
});
test('container lookup excludes code and escaped directives, and rejects duplicates and nested boundaries',()=>{
  const literal='```html\n'+containerBody(id,'Example')+'\n```\n\n';
  const document=literal+containerBody(id,'> Reply\n\n\\:::');
  assert.deepEqual(responseIds(document),[id]);assert.equal(regionBody(document,id)?.body,'> Reply\n\n\\:::');
  assert.throws(()=>responseRegion(document+'\n'+responseAnchor(id),id),/duplicate/);
  assert.throws(()=>responseRegion(containerBody(id,responseAnchor(other)),id),/Nested/);
  assert.throws(()=>responseRegion(responseAnchor(id).replace(containerEnd,''),id),/boundaries/);
  assert.throws(()=>responseRegion(responseAnchor(id).replace('send-to-t3-response','changed-directive'),id),/Malformed/);
  assert.equal(responseBoundaries('\\'+containerStart(id)+'\n\n'+containerEnd).length,0);
});
test('ordinary section closing tags and literal examples cannot close the active container',()=>{
  const body='<section>\n\nOrdinary inner section\n\n</section>\n\n`</section>`';
  assert.equal(responseFrame(containerBody(id,body),id)?.body,body);
});
test('finished answers can describe container IDs and literal syntax without introducing tracking',()=>{
  assert.doesNotThrow(()=>validateFinalResponseBody('The field is `data-t3-response="'+id+'"`.'));
  assert.doesNotThrow(()=>validateFinalResponseBody('<pre><code>data-t3-response=&quot;'+id+'&quot;</code></pre>'));
  assert.doesNotThrow(()=>validateFinalResponseBody('```md\n'+containerBody(id,'Example')+'\n```'));
  assert.throws(()=>validateFinalResponseBody(containerBody(id,'Actual registration')),/tracking boundaries/);
});
test('a generated stray closer cannot truncate the validated projection frame',()=>{
  assert.throws(()=>projectResponses(responseAnchor(id),[{id,body:'Before\n\n'+containerEnd+'\n\nAfter'}]),/boundaries|container/i);
});
test('literal legacy markers do not change container format, and legacy repair retains its original anchor',()=>{
  const example='```html\n'+legacy(id)+'\n```\n\n',saved=example+responseAnchor(id);
  const projection=projectResponses(saved,[{id,body:'Reply'}]);
  assert.equal(savedProjection(projection.display,projection),saved);
  assert.equal(responseAnchor(id,saved),responseAnchor(id));
  const original='Before\n'+legacy(id)+'\nAfter',missing=original.replace(legacy(id),'');
  assert.equal(restoreResponseAnchor(id,original,missing),original);
  assert.equal(restoreResponseAnchor(id,original,original),original);
});
test('new native registrations use containers only after host negotiation and retries keep the same destination',async()=>{
  for(const modern of [false,true]){
    let document='Before\n';const source:any={version:4,id:other,initialOwner:id,vaultId:'vault',host:{environmentId:'machine',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:'A.md',threadId:'thread',messageId:id,projectId:'project',threadEnvironmentId:'machine',initialHash:initialRegion(other).bodyHash,createdAt:'2026-10-11T00:00:00Z',nativeProjection:true,responseContainer:modern};
    const io={updateNote:async(_path:string,change:(text:string)=>string)=>document=change(document)};
    const request=await editorStream(source,'A.md',io,()=>true),original=document;
    assert.equal(document.includes('data-t3-response='),modern);assert.equal(document.includes('<!-- t3-inline:'),!modern);
    assert.equal(eventContent(document),eventContent('Before\n'));assert.equal(await editorStream(source,'A.md',io,()=>true).then(request=>request.id),request.id);assert.equal(document,original);
  }
});
test('moved and duplicated saved containers use the existing destination recovery checks',async()=>{
  const notes=new Map([['Moved.md',responseAnchor(id)],['Example.md','```html\n'+responseAnchor(id)+'\n```']]);
  const locator=new ResponseNoteLocator(()=>[...notes.keys()],async path=>notes.get(path));
  assert.equal(await locator.locate(id,'Old.md'),'Moved.md');
  notes.set('Copy.md',responseAnchor(id));locator.changed('Copy.md');await assert.rejects(locator.locate(id,'Moved.md'),/multiple notes/);
});
test('question and approval cleanup leaves controls inside active containers for the response writer',()=>{
  const target={environmentId:'machine',threadId:'thread',requestId:'request'},request:any={requestId:'request',questions:[{id:'q',header:'Question',question:'Choose',options:[]}]};
  const question=renderQuestion(request,target),approval=renderApproval({requestId:'request',kind:'command',summary:'Review command',command:'pwd'} as any,target);
  const document=containerBody(id,question+'\n\n'+approval);
  assert.equal(clearResolvedQuestion(document,target),document);assert.equal(removeDismissedQuestions(document,()=>true),document);assert.equal(clearApprovalControls(document,target),document);
});
test('Source and Live Preview hide container syntax and its extra separators, preserving legacy line layout',()=>{
  const body='**T3 · Working**\n\n> Reply',document='Before\n'+renderResponse(id,body)+'\nAfter';
  const extension=hiddenInlineMarkerExtension() as any[],field=extension[2] as StateField<DecorationSet>,state=EditorState.create({doc:document,extensions:[field]});
  const ranges:Array<[number,number]>=[];state.field(field).between(0,document.length,(from:number,to:number)=>{ranges.push([from,to]);});
  let visible=document;for(const [from,to] of ranges.reverse())visible=visible.slice(0,from)+visible.slice(to);
  assert.equal(visible,'Before\n\n'+body+'\n\nAfter');
  const literal='```html\n'+document+'\n```',code=EditorState.create({doc:literal,extensions:[field]});assert.equal(code.field(field).size,0);
});
