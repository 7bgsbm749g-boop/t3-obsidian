import test from 'node:test';
import assert from 'node:assert/strict';
import {clearSmartSendPreparation,loadSmartSend,mergeSmartSend,prepareSmartSend,explicitSelectionText,confirmSmartSend,rememberResponse,rememberNoteEdits,smartNote,sourceProjection,moveSmartNotes,packText,unpackText} from '../src/notes/smart-send';
import {responseAnchor} from '../src/responses/native-response-projection';
import {findRunImport,runImportReceipt} from '../src/conversations/run-import-receipt';
const path='Jobs/Smart.md',destination='machine/project/thread';
const fresh=()=>loadSmartSend(undefined);
const importSource={environmentId:'machine',projectId:'project',threadId:'thread'};
const importReceipt=runImportReceipt({version:1,...importSource,bindingId:'11111111-1111-4111-8111-111111111111',messageId:'prompt',runId:'run'});

test('explicit selection keeps exact Markdown and generated text while excluding private receipts',()=>{
 const identity='<!-- t3-note-id:'+'a'.repeat(64)+' -->';
 const source='**Selected user text.**\n> Selected agent reply.\n'+importReceipt+'\n'+identity+'\nTail.';
 assert.equal(explicitSelectionText(source,[0,source.length]),'**Selected user text.**\n> Selected agent reply.\n\n\nTail.');
 const from=source.indexOf(importReceipt)+7,to=source.indexOf('Tail.');assert.equal(explicitSelectionText(source,[from,to]),'\n\n');
});
test('explicit selections preserve receipt examples even when the surrounding code fences are not selected',()=>{
 const source='```md\n'+importReceipt+'\n<!-- t3-note-id:'+'b'.repeat(64)+' -->\n```';
 assert.equal(explicitSelectionText(source,[6,source.length-4]),source.slice(6,-4));
});

test('staged agent additions and replacements are excluded for every destination, preserving unsent user text',async()=>{
  const data=fresh(),before='Unsent user opening.\n\nOld wording.\n\nUnsent user ending.',after=before.replace('Old wording.','Agent replacement.\n\nAgent addition.');
  assert.equal(await rememberNoteEdits(data,path,'edit',before,after),true);
  assert.equal(await rememberNoteEdits(data,path,'edit',before,after),false);
  for(const target of [destination,'other-thread']){
    assert.equal((await prepareSmartSend(data,path,target,after)).text.replace(/\n+/g,'\n').trim(),'Unsent user opening.\nUnsent user ending.');
    const from=after.indexOf('Agent replacement.');
    assert.equal((await prepareSmartSend(data,path,target,after,[from,from+18])).text,'');
  }
});
test('user additions inside a staged edit remain source after settings merge, reload and rename',async()=>{
  const original=fresh(),before='Before\n\nOld\n\nAfter',after=before.replace('Old','Agent first line.\nAgent final line.');
  await rememberNoteEdits(original,path,'edit',before,after);
  const data=loadSmartSend(JSON.parse(JSON.stringify(mergeSmartSend(fresh(),original))));
  moveSmartNotes(data,path,'Moved.md');
  const document=after.replace('Agent first line.','**Agent first line.**\nUser insertion.')+'\nUser ending.';
  const sent=(await prepareSmartSend(data,'Moved.md',destination,document)).text;
  assert.match(sent,/User insertion\./);assert.match(sent,/User ending\./);assert.match(sent,/Before/);assert.match(sent,/After/);
  assert.doesNotMatch(sent,/Agent|\*\*/);
});
test('staged deletions and unchanged drafts add no exclusion; duplicate user lines keep their occurrence',async()=>{
  const data=fresh();assert.equal(await rememberNoteEdits(data,path,'delete','Keep\nDelete\nTail','Keep\nTail'),false);
  assert.equal(await rememberNoteEdits(data,path,'same','Keep','Keep'),false);
  const before='Before\nSame line.\nAfter',after=before+'\nSame line.';
  await rememberNoteEdits(data,path,'repeat',before,after);
  assert.equal((await prepareSmartSend(data,path,destination,after)).text.trim(),before);
});
test('partial-word replacements exclude the resulting word and punctuation without suppressing other user words',async()=>{
  const data=fresh();await rememberNoteEdits(data,path,'word','User says it can. More user text.','User says it cannot. More user text.');
  assert.equal((await prepareSmartSend(data,path,destination,'User says it cannot. More user text.')).text,'User says it  More user text.');
});
test('independent staged edit records for the same resulting snapshot merge without losing exclusions',async()=>{
  const a=fresh(),b=fresh(),after='Agent first.\nAgent second.\nUser tail.';
  await rememberNoteEdits(a,path,'shared','Old one.\nAgent second.\nUser tail.',after);
  await rememberNoteEdits(b,path,'shared','Agent first.\nOld two.\nUser tail.',after);
  const merged=mergeSmartSend(a,b);assert.equal(Object.keys(merged.noteEdits!).length,2);
  assert.equal((await prepareSmartSend(merged,path,destination,after)).text.trim(),'User tail.');
});

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
test('an observed rename joins independently discovered coverage and reply records',async()=>{
  const {data}=await send(),old=smartNote(data,path);
  await rememberResponse(data,path,'reply','Agent reply.','','',0);
  const next='Moved.md',newId=smartNote(data,next);
  const branch=await prepareSmartSend(data,next,destination,'First request. Added.');confirmSmartSend(data,'branch',destination,branch.capture);
  moveSmartNotes(data,path,next);assert.notEqual(old,newId);
  const plan=await prepareSmartSend(data,next,destination,'First request. Added.\nAgent reply.\nMore.');
  assert.equal(plan.text.trim(),'More.');assert.deepEqual(new Set(plan.capture.parents),new Set(['one','branch']));
  confirmSmartSend(data,'successor',destination,plan.capture);
  assert.deepEqual(Object.keys(data.heads),['successor']);
});
test('an unrelated path starts with independent coverage and deleting the original never grants its old identity',async()=>{
 const {data}=await send(),id=smartNote(data,path);
 assert.equal((await prepareSmartSend(data,'Copy.md',destination,'First request.')).text,'First request.');
 moveSmartNotes(data,path);assert.notEqual(smartNote(data,path),id);
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

test('unchanged projections avoid decompression even when decoded replies exceed the cache budget',async()=>{
 const data=fresh();for(let n=0;n<4;n++)await rememberResponse(data,path,'large-'+n,'Generated '+n+' '+String.fromCharCode(65+n).repeat(600000),'','',0);
 const Original=globalThis.DecompressionStream;let reads=0;
 globalThis.DecompressionStream=class extends Original {constructor(format:CompressionFormat){super(format);reads++;}};
 try{
  assert.equal((await prepareSmartSend(data,path,destination,'Current user text.')).text,'Current user text.');assert.equal(reads,4);
  for(let n=0;n<3;n++)assert.equal((await prepareSmartSend(data,path,destination,'Current user text.')).text,'Current user text.');assert.equal(reads,4);
  assert.equal((await prepareSmartSend(data,path,'other destination','Current user text.')).text,'Current user text.');assert.equal(reads,4);
 }finally{globalThis.DecompressionStream=Original;}
});
test('projection cache observes new and merged receipts, edits, note aliases and current typing',async()=>{
 const data=fresh(),document='User opening.\n\nAgent line.\n\nUser tail.';
 assert.match((await prepareSmartSend(data,path,destination,document)).text,/Agent line/);
 await rememberResponse(data,path,'new','Agent line.','User opening.\n\n','\n\nUser tail.',15);
 assert.doesNotMatch((await prepareSmartSend(data,path,destination,document)).text,/Agent line/);
 assert.match((await prepareSmartSend(data,path,destination,document.replace('Agent line.','Agent line.\nNew user insertion.'))).text,/New user insertion/);
 const other=fresh();await rememberNoteEdits(other,path,'edit',document,document+'\nAgent edit.');Object.assign(data,mergeSmartSend(data,other));
 assert.doesNotMatch((await prepareSmartSend(data,path,destination,document+'\nAgent edit.')).text,/Agent edit/);
 moveSmartNotes(data,path,'Moved.md');assert.doesNotMatch((await prepareSmartSend(data,'Moved.md',destination,document)).text,/Agent line/);
});
test('an incomplete projection is retried after its missing body arrives',async()=>{
 const data=fresh();await rememberResponse(data,path,'reply','Generated body.','','',0);const record=Object.values(data.responses)[0],body=data.bodies[record.body];delete data.bodies[record.body];
 await assert.rejects(sourceProjection(data,record.noteId,'Generated body.\nUser text.'),/missing/);
 data.bodies[record.body]=body;assert.equal((await prepareSmartSend(data,path,destination,'Generated body.\nUser text.')).text.trim(),'User text.');
});

test('unchanged source snapshots reuse compression without sharing mutable packed records',async()=>{
 const Original=globalThis.CompressionStream;let calls=0;
 globalThis.CompressionStream=class extends Original {constructor(format:CompressionFormat){super(format);calls++;}};
 try{
  const text='Unique packed source for reuse.\n'.repeat(1200),first=await packText(text);first.data='Caller changed its copy';
  const second=await packText(text);assert.equal(calls,1);assert.equal(await unpackText(second),text);assert.notEqual(second.data,first.data);
 }finally{globalThis.CompressionStream=Original;}
});

test('same revision preparations coalesce compressed capture and return independent mutable values',async()=>{
 const Original=globalThis.CompressionStream;let calls=0;
 globalThis.CompressionStream=class extends Original {constructor(format:CompressionFormat){super(format);calls++;}};
 try{
  const data=fresh(),document='Preparation coalescing with Markdown **source**.\n'.repeat(100),scope: [number,number]=[0,document.length];
  const plans=await Promise.all(Array.from({length:4},()=>prepareSmartSend(data,path,destination,document,scope)));
  assert.equal(calls,1);for(const plan of plans)assert.deepEqual(plan,plans[0]);
  plans[0].capture.source.data='modified';plans[0].capture.covered[0][0]=99;plans[0].capture.parents.push('modified');plans[0].capture.bindings!.push('modified');plans[0].ranges[0][0]=99;
  assert.deepEqual(await prepareSmartSend(data,path,destination,document,scope),plans[1]);
 }finally{globalThis.CompressionStream=Original;}
});
test('preparation reuses destination coverage even when decoded heads exceed the cache budget',async()=>{
 const data=fresh(),noteId=smartNote(data,path);
 for(let n=0;n<4;n++)data.heads['head-'+n]={noteId,destination,source:await packText('Historical '+n+' '+String.fromCharCode(75+n).repeat(600000)),covered:[[0,600000]],parents:[],bindings:['binding-'+n]};
 const Original=globalThis.DecompressionStream;let reads=0;
 globalThis.DecompressionStream=class extends Original {constructor(format:CompressionFormat){super(format);reads++;}};
 try{
  const first=await prepareSmartSend(data,path,destination,'Exact new user revision.');assert.equal(first.text,'Exact new user revision.');assert.equal(reads,4);
  for(let n=0;n<3;n++)assert.deepEqual(await prepareSmartSend(data,path,destination,'Exact new user revision.'),first);
  assert.equal(reads,4,'same-revision checks must not repeat destination decoding/diff work');
  data.heads.unrelated={...data.heads['head-0'],destination:'unrelated'};
  assert.deepEqual(await prepareSmartSend(data,path,destination,'Exact new user revision.'),first);assert.equal(reads,4);
 }finally{globalThis.DecompressionStream=Original;}
});
test('preparation observes confirmations, scope, destination, typing and merged coverage branches',async()=>{
 const data=fresh(),document='First paragraph.\n\nSecond paragraph.',scope: [number,number]=[0,16];
 const first=await prepareSmartSend(data,path,destination,document,scope);
 assert.equal(first.text,'First paragraph.');confirmSmartSend(data,'first',destination,first.capture,['first-binding']);
 assert.equal((await prepareSmartSend(data,path,destination,document,scope)).text,'');
 const next=await prepareSmartSend(data,path,destination,document);assert.equal(next.text.trim(),'Second paragraph.');assert.deepEqual(next.capture.parents,['first']);assert.deepEqual(next.capture.bindings,['first-binding']);
 assert.equal((await prepareSmartSend(data,path,'new destination',document)).text,document);
 assert.equal((await prepareSmartSend(data,path,destination,document,[18,document.length])).text,'Second paragraph.');
 assert.match((await prepareSmartSend(data,path,destination,document+'\nUser typing.')).text,/User typing\./);
 const remote=loadSmartSend(JSON.parse(JSON.stringify(data))),branch=await prepareSmartSend(remote,path,destination,document,[18,document.length]);confirmSmartSend(remote,'remote',destination,branch.capture,['remote-binding']);
 Object.assign(data,mergeSmartSend(data,remote));
 const merged=await prepareSmartSend(data,path,destination,document);assert.equal(merged.text,'');assert.deepEqual(merged.capture.parents,['remote']);assert.deepEqual(merged.capture.bindings,['first-binding','remote-binding']);
 assert.equal(explicitSelectionText(document,scope),'First paragraph.','explicit resends still use the full selected source');
});
test('failed destination preparation can retry after a repaired head arrives',async()=>{
 const data=fresh(),noteId=smartNote(data,path),source=await packText('Repairable original.');
 data.heads.broken={noteId,destination,source:{hash:'f'.repeat(64),encoding:'text',data:'bad content'},covered:[[0,source.data.length]],parents:[]};
 await assert.rejects(prepareSmartSend(data,path,destination,'Repairable original.'),/content check/);
 data.heads.broken={...data.heads.broken,source};
 assert.equal((await prepareSmartSend(data,path,destination,'Repairable original.')).text,'');
});


test('preparation keeps only one revision and fences dialog, route, credential and settings generations',async()=>{
 const data=fresh(),noteId=smartNote(data,path);
 for(let n=0;n<4;n++)data.heads['head-'+n]={noteId,destination,source:await packText('Generation '+n+' '+String.fromCharCode(65+n).repeat(600000)),covered:[[0,600000]],parents:[]};
 const Original=globalThis.DecompressionStream;let reads=0;
 globalThis.DecompressionStream=class extends Original {constructor(format:CompressionFormat){super(format);reads++;}};
 try{
  const dialog={},credential={},settings={},generation=[dialog,'route-one',credential,settings];
  const prepare=(document='Unsent revision.',epoch=generation)=>prepareSmartSend(data,path,destination,document,undefined,epoch);
  await prepare();assert.equal(reads,4);await prepare();assert.equal(reads,4);
  for(const epoch of [[{},'route-one',credential,settings],[dialog,'route-two',credential,settings],[dialog,'route-one',{},settings],[dialog,'route-one',credential,{}]]){await prepare(undefined,epoch);assert.equal(reads%4,0);}
  assert.equal(reads,20);await prepare();assert.equal(reads,24);
  await prepare('Edited revision.');assert.equal(reads,28);await prepare();assert.equal(reads,32,'returning to an older revision recomputes');
  clearSmartSendPreparation(data);await prepare();assert.equal(reads,36,'cancelled/finished attempts discard their entry');
  clearSmartSendPreparation(data);const pending=prepare();clearSmartSendPreparation(data);await pending;assert.equal(reads,40);await prepare();assert.equal(reads,44,'in-flight work cannot repopulate a cancelled generation');
  const oversized='x'.repeat(1_000_001)+'Oversized revision.';await prepare(oversized);assert.equal(reads,48);await prepare(oversized);assert.equal(reads,52,'oversized revisions are not retained');
 }finally{globalThis.DecompressionStream=Original;}
});
test('failed preparations are never retained even when the same corrupt receipt is retried',async()=>{
 const data=fresh(),noteId=smartNote(data,path);
 data.heads.bad={noteId,destination,source:{hash:'e'.repeat(64),encoding:'text',data:'corrupt'},covered:[],parents:[]};
 for(let n=0;n<2;n++)await assert.rejects(prepareSmartSend(data,path,destination,'Same failed revision.'),/content check/);
 delete data.heads.bad;assert.equal((await prepareSmartSend(data,path,destination,'Same failed revision.')).text,'Same failed revision.');
});

test('historical recovery receipts require exact note/source revisions and retained provenance after reload',async()=>{
  const {smartRecovery,hasSmartRecovery,rememberSmartRecovery}=await import('../src/notes/smart-send');
  let data=loadSmartSend(undefined);const document='User request\n\n> Synthetic reply\n';
  await rememberResponse(data,'History.md','history:thread:answer','> Synthetic reply','User request\n\n','\n',14);
  const identity=smartRecovery(data,'History.md',document,'environment/project/thread/binding');
  rememberSmartRecovery(data,identity,Object.keys(data.responses));
  data=mergeSmartSend(loadSmartSend(JSON.parse(JSON.stringify(data))),undefined);
  assert.equal(hasSmartRecovery(data,identity.key),true);
  assert.equal(hasSmartRecovery(data,smartRecovery(data,'History.md',document+'Edit','environment/project/thread/binding').key),false);
  assert.equal(hasSmartRecovery(data,smartRecovery(data,'History.md',document,'different-source').key),false);
  const changed=loadSmartSend(JSON.parse(JSON.stringify(data)));Object.values(changed.responses)[0].offset++;
  assert.equal(hasSmartRecovery(changed,identity.key),false);
  const missing=loadSmartSend(JSON.parse(JSON.stringify(data)));delete missing.bodies[Object.values(missing.responses)[0].body];
  assert.equal(hasSmartRecovery(missing,identity.key),false);
  moveSmartNotes(data,'History.md','Moved.md');assert.equal(hasSmartRecovery(data,identity.key),false);
});

test('negative historical recovery checks persist and receipts remain bounded',async()=>{
  const {smartRecovery,hasSmartRecovery,rememberSmartRecovery}=await import('../src/notes/smart-send');
  const data=loadSmartSend(undefined),identity=smartRecovery(data,'Empty.md','User request','checked-source');
  rememberSmartRecovery(data,identity,[]);assert.equal(hasSmartRecovery(loadSmartSend(data),identity.key),true);
  for(let n=0;n<160;n++)rememberSmartRecovery(data,smartRecovery(data,'Empty.md','User request '+n,'checked-source'),[]);
  assert.equal(Object.keys(mergeSmartSend(data).recoveries??{}).length,128);
});


test('newer checked recovery receipts survive old settings and bounded-cache merges',async()=>{
 const {smartRecovery,rememberSmartRecovery}=await import('../src/notes/smart-send');
 const data=loadSmartSend(undefined),identity=smartRecovery(data,'History.md','User request','source');rememberSmartRecovery(data,identity,[]);
 const old=loadSmartSend(JSON.parse(JSON.stringify(data)));old.recoveries![identity.key].checkedAt=1;data.recoveries![identity.key].checkedAt=2;
 assert.equal(mergeSmartSend(data,old).recoveries![identity.key].checkedAt,2);
 for(let n=0;n<150;n++){const next=smartRecovery(data,'History.md','Revision '+n,'source');rememberSmartRecovery(data,next,[]);data.recoveries![next.key].checkedAt=100+n;}
 const latest=smartRecovery(data,'History.md','Latest revision','source');rememberSmartRecovery(data,latest,[]);
 assert.ok(mergeSmartSend(data,old).recoveries![latest.key]);
});
