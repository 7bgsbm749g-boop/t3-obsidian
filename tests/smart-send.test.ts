import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSmartSend,mergeSmartSend,prepareSmartSend,confirmSmartSend,rememberResponse,smartNote,sourceProjection,moveSmartNotes,packText,unpackText} from '../smart-send';
import {responseAnchor} from '../native-response-projection';
const path='Jobs/Smart.md',destination='machine/project/thread';
const fresh=()=>loadSmartSend(undefined);
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
test('large repeated response text is compressed and round-trips without extra note files',async()=>{
  const text='Large agent response 🦉\n'.repeat(1000),packed=await packText(text);assert.equal(packed.encoding,'gzip');assert.ok(packed.data.length<text.length/5);assert.equal(await unpackText(packed),text);
});
