import {test} from 'node:test';
import assert from 'node:assert/strict';
import {thoughtPresentation,liveThoughtLine} from '../src/responses/response-thought';
import {renderResponseToolGroup} from '../src/responses/response-tools';
import {presentToolGroups,restoreToolGroups} from '../src/responses/response-tool-presentation';

const group=(text:string)=>renderResponseToolGroup({id:'group',turnId:'run',tools:[],thoughts:[{id:'public',role:'reasoning',turnId:'run',text,streaming:false}]});
test('a short public summary is its label and has no disclosure',()=>{
  for(const text of ['Checking release structure','**Checking release structure**','Checking release. Reviewing tests.']){
    const view=thoughtPresentation(text);assert.equal(view.expandable,false);assert.ok(view.label.includes('Checking release'));
    const body=group(text);assert.match(body,/<div class="send-to-t3-thought"/);assert.doesNotMatch(body,/<details class="send-to-t3-thought"|send-to-t3-thought-content/);
    const p=presentToolGroups(body);assert.equal(p.groups.length,1);assert.equal(restoreToolGroups(p.display,p),body);
  }
});
test('long public traces use a heading or first sentence and preserve their full formatted body',()=>{
  for(const [text,label] of [['**Checking release structure**\n\nVerify **every commit** before delivery.','Checking release structure'],['## Checking release structure\n\nVerify every commit.','Checking release structure'],['Checking release structure.\n\nVerify every commit.','Checking release structure.']]){
    const view=thoughtPresentation(text);assert.equal(view.label,label);assert.equal(view.expandable,true);
    const body=group(text);assert.match(body,/<details class="send-to-t3-thought"/);assert.match(body,/send-to-t3-thought-content/);assert.match(body,/every commit/);
    assert.match(body,/class="send-to-t3-thought-label" title="Checking release structure/);
    const p=presentToolGroups(body);assert.equal(p.groups.length,1);assert.equal(restoreToolGroups(p.display,p),body);
  }
});
test('long unbroken text is bounded without splitting Unicode and remains expandable',()=>{
  const text='🔎'.repeat(150),view=thoughtPresentation(text);assert.equal(Array.from(view.label).length,120);assert.ok(view.label.endsWith('…'));assert.equal(view.expandable,true);assert.ok(!view.label.includes('\uFFFD'));
  assert.match(group(text),/send-to-t3-thought-content/);
});
test('public labels cannot inject HTML and previews stop at a heading or first sentence',()=>{
  const body=group('<img src=x onerror="bad">');assert.doesNotMatch(body,/<img|onerror="bad"/);assert.match(body,/&lt;img/);
  assert.equal(liveThoughtLine('## Review changes\n\nA public trace.'),'Review changes');
  assert.equal(liveThoughtLine('Review changes. Next sentence.'),'Review changes.');
});
