import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSmartSend,mergeSmartSend,prepareSmartSend,confirmSmartSend,rememberResponse,smartNote,sourceProjection,moveSmartNotes,recoverSmartNote,packText,unpackText} from '../smart-send';
import {responseAnchor} from '../native-response-projection';
import {findRunImport,runImportReceipt} from '../run-import-receipt';
const path='Jobs/Smart.md',destination='machine/project/thread';
const fresh=()=>loadSmartSend(undefined);
const importSource={environmentId:'machine',projectId:'project',threadId:'thread'};
const importReceipt=runImportReceipt({version:1,...importSource,bindingId:'11111111-1111-4111-8111-111111111111',messageId:'prompt',runId:'run'});

test('steering source ranges exclude confirmed source and generated responses',async()=>{
  const data=fresh(),first=await prepareSmartSend(data,path,destination,'Keep this original.');confirmSmartSend(data,'first',destination,first.capture);
  const document='Keep this original.\n\n'+responseAnchor('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')+'\n\nNew steer.\n';
  const plan=await prepareSmartSend(data,path,destination,document);
  assert.match(plan.text,/New steer/);assert.equal(plan.ranges.map(range=>document.slice(...range)).join('').trim(),'New steer.');
  assert.ok(plan.ranges.every(([from])=>from>document.indexOf(':::') ));
});
test('decoration-only changes cannot become steering removal ranges',async()=>{
  const first=await send(fresh(),'Keep this original.');
  const plan=await prepareSmartSend(first.data,path,destination,'**Keep this original.**');
  assert.equal(plan.text,'');assert.deepEqual(plan.ranges,[]);
});
async function send(data= fresh(),text='First request.',scope?:[number,number],id='one',target=destination){const plan=await prepareSmartSend(data,path,target,text,scope);if(plan.text.trim())confirmSmartSend(data,id,target,plan.capture);return {data,...plan};}

test('first send includes the requested source and confirmed repeats have no payload',async()=>{
  const first=await send();assert.equal(first.text,'First request.');assert.equal((await prepareSmartSend(first.data,path,destination,'First request.')).text,'');
  assert.equal((await prepareSmartSend(first.data,path,'other thread','First request.')).text,'First request.');
});
test('preparation and failures never mark text as sent; confirmation uses the captured version',async()=>{
  const data=fresh();const pending=await prepareSmartSend(data,path,destination,'First request.');assert.equal((await prepareSmartSend(data,path,destination,'First request.')).text,'First request.');
  confirmSmartSend(data,'accepted',destination,pending.capture);assert.equal((await prepareSmartSend(data,path,destination,'First request.\nLater typing.')).text.trim(),'Later typing.');
});
test('added text is sent in current note order; deletions and blank changes send nothing',async()=>{
  const {data}=await send(fresh(),'First\n\nMiddle\n\nLast');
  assert.equal((await prepareSmartSend(data,path,destination,'First\n\nLast')).text,'');
  assert.equal((await prepareSmartSend(data,path,destination,'Top\nFirst\nMiddle\nAdded here\nLast\nBottom')).text.trim(),'Top\n\nAdded here\n\nBottom');
  assert.equal((await prepareSmartSend(data,path,destination,'First\n\n\nMiddle\n\nLast\n')).text,'');
});
test('typing on an existing line sends the added characters; replacement has no change label',async()=>{
  const {data}=await send(fresh(),'Build a timer.');
  assert.equal((await prepareSmartSend(data,path,destination,'Build a blue timer.')).text,'blue ');
  const next=await send(data,'Build a blue timer.',undefined,'two');assert.equal(next.text,'blue ');
  assert.equal((await prepareSmartSend(data,path,destination,'Build a red timer.')).text,'red');
});
test('selection coverage never marks unselected source as sent',async()=>{
  const {data,text}=await send(fresh(),'First line\nSecond line',[0,5]);assert.equal(text,'First');
  assert.equal((await prepareSmartSend(data,path,destination,'First line\nSecond line')).text,' line\nSecond line');
});
test('repeated lines retain occurrence counts and appending another occurrence is new',async()=>{
  const {data}=await send(fresh(),'same\nsame');assert.equal((await prepareSmartSend(data,path,destination,'same\nsame\nsame')).text.trim(),'same');
});
test('response records exclude all threads, generated history and final prose without note markers',async()=>{
  const data=fresh(),body='> Agent reply.\n\nFinal response.',document=`User request.\n\n${body}\n\nUser addition.`;
  await rememberResponse(data,path,'response from other thread',body,'User request.\n\n','\n\nUser addition.',15);
  const plan=await prepareSmartSend(data,path,destination,document);assert.equal(plan.text,'User request.\n\n\n\nUser addition.');assert.equal(document.includes('<!--'),false);
  assert.equal(Object.keys(data.bodies).length,1);
  await rememberResponse(data,'Other.md','mirror',body,'','',0);assert.equal(Object.keys(data.bodies).length,1);
});
test('imported replies and their tracking receipts stay out of Smart Send without changing the saved note',async()=>{
  const data=fresh(),body='Imported prompt and progress.\n\nImported final answer.',later='Later imported answer.';
  const before='My note.\n\n',between='\n'+importReceipt+'\n\n',after='\n\nMy new question.';
  const document=before+body+between+later+after;
  await rememberResponse(data,path,'imported',body,before,between+later+after,before.length);
  await rememberResponse(data,path,'followed',later,before+body+between,after,before.length+body.length+between.length);
  const plan=await prepareSmartSend(data,path,destination,document);
  assert.equal(plan.text.replace(/\n+/g,'\n').trim(),'My note.\nMy new question.');
  assert.doesNotMatch(plan.text,/Imported|imported|t3-run-import/);
  assert.equal(findRunImport(document,importSource,'prompt')?.runId,'run');
  confirmSmartSend(data,'sent',destination,plan.capture);
  assert.equal((await prepareSmartSend(data,path,destination,document)).text,'');
  assert.equal((await prepareSmartSend(data,path,destination,document+'\nOnly this addition.')).text.trim(),'Only this addition.');
});
test('import receipts alone cannot enable a send, and scoped sends retain raw note offsets around receipts',async()=>{
  const data=fresh();
  assert.equal((await prepareSmartSend(data,path,destination,importReceipt+'\n'+importReceipt)).text,'');
  const document='Before'+importReceipt+'After\n'+importReceipt+'\nTail';
  assert.equal((await prepareSmartSend(data,path,destination,document)).text,'BeforeAfter\n\nTail');
  const at=document.indexOf('After');
  assert.equal((await prepareSmartSend(data,path,destination,document,[at,at+5])).text,'After');
  assert.equal((await prepareSmartSend(data,path,destination,document,[6,at])).text,'');
  assert.equal((await prepareSmartSend(data,path,destination,document,[document.indexOf('Tail'),document.length])).text,'Tail');
});
test('literal import-comment examples and invalid comments remain ordinary Smart Send source',async()=>{
  const invalid=[
    '<!-- t3-run-import:%zz -->',
    '<!-- t3-run-import:'+encodeURIComponent(JSON.stringify({version:2,...importSource,bindingId:'11111111-1111-4111-8111-111111111111',messageId:'prompt',runId:'run'}))+' -->',
    '<!-- t3-run-import:'+encodeURIComponent(JSON.stringify({version:1,...importSource,bindingId:'wrong',messageId:'prompt',runId:'run'}))+' -->',
    '<!-- t3-run-import:'+encodeURIComponent(JSON.stringify({version:1,bindingId:'11111111-1111-4111-8111-111111111111',messageId:'prompt',runId:'run'}))+' -->',
  ];
  const examples='`'+importReceipt+'`\n\n```md\n'+importReceipt+'\n```\n\n    '+importReceipt+'\n\n'+invalid.join('\n')+'\n\n';
  const document=examples+importReceipt;
  const data=fresh(),projection=await sourceProjection(data,smartNote(data,path),document);
  assert.equal(projection.text,examples);
});
test('ordinary quotes and fenced examples remain source; active response bodies are excluded',async()=>{
  const data=fresh(),id='11111111-1111-4111-8111-111111111111',anchor=responseAnchor(id),document=`> My quote\n\n${anchor}\n\n\`\`\`md\n${anchor}\n\`\`\``;
  const source=await sourceProjection(data,smartNote(data,path),document);assert.match(source.text,/> My quote/);assert.equal(source.text.split('data-t3-response').length,2);
});
test('edits inside a saved reply retain user additions and exclude unchanged agent lines',async()=>{
  const data=fresh();await rememberResponse(data,path,'reply','Agent first.\nAgent last.','Before\n','\nAfter',7);
  const result=await prepareSmartSend(data,path,destination,'Before\nAgent first.\nUser insertion.\nAgent last.\nAfter');
  assert.match(result.text,/User insertion/);assert.doesNotMatch(result.text,/Agent first|Agent last/);
});
test('typing inside a completed recorded progress box remains new source',async()=>{
  const data=fresh(),header='> [!t3-progress]- **Agent · Completed** <span class="send-to-t3-fold-key" data-t3-fold="thread:complete"></span>';
  const body=header+'\n>\n> Agent work.\n\nFinal.';
  await rememberResponse(data,path,'reply',body,'Before\n','\nAfter',7);
  const result=await prepareSmartSend(data,path,destination,'Before\n'+body.replace('> Agent work.','> Agent work.\n> User addition.')+'\nAfter');
  assert.match(result.text,/User addition/);assert.doesNotMatch(result.text,/Agent work|Completed|Final\./);
});
test('editing a saved answer excludes its original text when its saved separator repeats',async()=>{
  const before='My original question.\n\n',opening='The saved answer starts with these explicit rules.\n\n',ending='The final paragraph explains the remaining behavior in enough detail to identify the end of this saved response.\n';
  const body=opening+['First generated rule.','Second generated rule.','Third generated rule.'].join('\n\n')+'\n\n'+ending;
  const {data}=await send(fresh(),before);
  await rememberResponse(data,path,'reply',body,before,'\n\n',before.length);
  const addition='My question about the second rule.',anchor=responseAnchor('11111111-1111-4111-8111-111111111111');
  const document=before+body.replace('Second generated rule.','Second generated rule.\n\n'+addition+'\n\n'+anchor)+'\n\n';
  const plan=await prepareSmartSend(data,path,destination,document);
  assert.equal(plan.text.trim(),addition);assert.doesNotMatch(plan.text,/generated rule|saved answer|final paragraph|send-to-t3-response/);
  confirmSmartSend(data,'followup',destination,plan.capture);
  assert.equal((await prepareSmartSend(data,path,destination,document)).text,'');
});
test('stored reply text locates edits after surrounding prose changes and keeps later source',async()=>{
  const data=fresh(),before='Original context.\n\n',body='A distinctive opening paragraph from the agent, with sufficient detail to identify its beginning.\n\nMiddle generated paragraph.\n\nA distinctive final paragraph from the agent, with sufficient detail to identify its ending.\n';
  await rememberResponse(data,path,'reply',body,before,'\n\n',before.length);
  const document='Edited context.\n\n'+body.replace('Middle generated paragraph.','Middle generated paragraph.\n\nMy inserted question.')+'\n\nLater source.\n\n';
  const plan=await prepareSmartSend(data,path,destination,document);
  assert.equal(plan.text.replace(/\n+/g,'\n').trim(),'Edited context.\nMy inserted question.\nLater source.');
});
test('ambiguous copies of an edited reply are not classified by whitespace or old offsets',async()=>{
  const data=fresh(),body='Distinctive original opening.\n\n'+ 'Generated middle.\n\n'.repeat(15)+'Distinctive original ending.\n';
  await rememberResponse(data,path,'reply',body,'\n\n','\n\n',2);
  const edited=body.replace('Distinctive original ending.','User edit.\nDistinctive original ending.'),document='\n\n'+edited+'\n\n'+edited+'\n\n';
  assert.equal((await prepareSmartSend(data,path,destination,document)).text,document);
});
test('parallel confirmed branches merge, and a successor retires only observed branches',async()=>{
  const root=(await send(fresh(),'Base')).data,a=mergeSmartSend(root),b=mergeSmartSend(root);
  await send(a,'Base\nFrom A',undefined,'a');await send(b,'Base\nFrom B',undefined,'b');
  const merged=mergeSmartSend(a,b);assert.equal(Object.keys(merged.heads).length,2);
  assert.equal((await prepareSmartSend(merged,path,destination,'Base\nFrom A\nFrom B')).text,'');
  await send(merged,'Base\nFrom A\nFrom B\nNew',undefined,'c');
  const stale=mergeSmartSend(merged,root,a,b);assert.deepEqual(Object.keys(stale.heads),['c']);assert.equal((await prepareSmartSend(stale,path,destination,'Base\nFrom A\nFrom B\nNew')).text,'');
});
test('stable note identity follows rename, move back, deletion and recreation',async()=>{
  const {data}=await send();const id=smartNote(data,path);moveSmartNotes(data,path,'Moved.md');assert.equal(smartNote(data,'Moved.md'),id);
  assert.equal((await prepareSmartSend(data,'Moved.md',destination,'First request.')).text,'');
  moveSmartNotes(data,'Moved.md',path);assert.equal(smartNote(data,path),id);moveSmartNotes(data,path);assert.notEqual(smartNote(data,path),id);
});
test('independent note discovery gives the same identity regardless of other notes',()=>{
  const a=fresh(),b=fresh();smartNote(a,'Unrelated.md');assert.equal(smartNote(a,path),smartNote(b,path));
});
test('a synced old-path deletion cannot overwrite a rename, including a rename back',async()=>{
  const base=(await send()).data,id=smartNote(base,path),renamed=mergeSmartSend(base),deleted=mergeSmartSend(base);
  moveSmartNotes(renamed,path,'Moved.md');moveSmartNotes(deleted,path);
  deleted.notes[id].revision=renamed.notes[id].revision+100;
  for(const merged of [mergeSmartSend(deleted,renamed),mergeSmartSend(renamed,deleted)]){
    assert.equal(merged.notes[id].path,'Moved.md');assert.ok(!merged.notes[id].deleted);
    assert.equal((await prepareSmartSend(merged,'Moved.md',destination,'First request. Added.')).text,' Added.');
  }
  moveSmartNotes(renamed,'Moved.md',path);
  const back=mergeSmartSend(renamed,deleted);assert.equal(back.notes[id].path,path);assert.ok(!back.notes[id].deleted);
  moveSmartNotes(back,path);assert.ok(mergeSmartSend(renamed,back).notes[id].deleted);
});
test('verified rename recovery joins independently discovered coverage and reply records',async()=>{
  const {data}=await send(),old=smartNote(data,path);
  await rememberResponse(data,path,'reply','Agent reply.','','',0);moveSmartNotes(data,path);
  const next='Moved.md',newId=smartNote(data,next);
  const branch=await prepareSmartSend(data,next,destination,'First request. Added.');confirmSmartSend(data,'branch',destination,branch.capture);
  assert.ok(recoverSmartNote(data,next,[old],()=>false));assert.notEqual(old,newId);
  const plan=await prepareSmartSend(data,next,destination,'First request. Added.\nAgent reply.\nMore.');
  assert.equal(plan.text.trim(),'More.');assert.deepEqual(new Set(plan.capture.parents),new Set(['one','branch']));
  confirmSmartSend(data,'successor',destination,plan.capture);
  assert.deepEqual(Object.keys(data.heads),['successor']);
});
test('recovery requires an absent original and unambiguous source identity',async()=>{
  const {data}=await send(),id=smartNote(data,path);
  assert.equal(recoverSmartNote(data,'Copy.md',[id],()=>true),false);
  assert.equal((await prepareSmartSend(data,'Copy.md',destination,'First request.')).text,'First request.');
  const other=smartNote(data,'Other.md');
  assert.equal(recoverSmartNote(data,'Moved.md',[id,other],()=>false),false);
  moveSmartNotes(data,path);assert.equal(recoverSmartNote(data,path,[id],()=>false),false);
  assert.notEqual(smartNote(data,path),id);
});
test('binding provenance survives accepted successors and settings reloads',async()=>{
  const data=fresh(),first=await prepareSmartSend(data,path,destination,'First request.');
  confirmSmartSend(data,'one',destination,first.capture,['source-response']);
  const next=await prepareSmartSend(data,path,destination,'First request. Added.');
  confirmSmartSend(data,'two',destination,next.capture,['next-response']);
  assert.deepEqual(loadSmartSend(JSON.parse(JSON.stringify(data))).heads.two.bindings,['source-response','next-response']);
});
test('large repeated response text is compressed and round-trips without extra note files',async()=>{
  const text='Large agent response 🦉\n'.repeat(1000),packed=await packText(text);assert.equal(packed.encoding,'gzip');assert.ok(packed.data.length<text.length/5);assert.equal(await unpackText(packed),text);
});
