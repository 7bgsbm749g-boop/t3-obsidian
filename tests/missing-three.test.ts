import {contentHash} from '../completion';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectMissingThree,suppliedNoteBlocks,leaseResponseEvidence,mergeNoteDeliveries,withMissingThree,type MissingThreeInput} from '../missing-three';
import {selectionAnchor,initialRegion} from '../inline-thread';
import {collectImages} from '../images';
import {Buffer} from 'buffer';
const id='11111111-1111-4111-8111-111111111111';
const response={id,threadId:'thread',projectId:'project',environmentId:'env',body:'> Response 2'};
function input(passage='Idea 3\n\nImplement',selected='Implement'):MissingThreeInput {
  const document=`Idea 1\n\n${response.body}\n\n${passage}`;
  const start=document.lastIndexOf(selected);
  return {document,anchor:selectionAnchor(document,selected,start,start+selected.length),prompt:selected,responses:[response],coverage:[],threadId:'thread',projectId:'project',environmentId:'env'};
}
test('returns omitted Markdown before the selected follow-up without intent matching',()=>{
  for(const word of ['Implement','Make it blue','yes','anything at all']){
    const result=detectMissingThree(input(`Idea 3\n\n${word}`,word));
    assert.equal(result.kind,'found');if(result.kind==='found')assert.equal(result.markdown,'Idea 3');
  }
});
test('3+4, full note, and an empty follow-up passage need no expansion',()=>{
  assert.equal(detectMissingThree(input('Idea 3\n\nImplement','Idea 3\n\nImplement')).kind,'none');
  assert.equal(detectMissingThree(input('Implement')).kind,'none');
  const full=input();full.anchor=selectionAnchor(full.document,full.document,0,full.document.length);
  assert.equal(detectMissingThree(full).kind,'none');
});
test('confirmed exact source blocks exclude unchanged text; edits and repeated occurrences resend',()=>{
  const original=input(),result=detectMissingThree(original);
  assert.equal(detectMissingThree({...original,coverage:result.blocks}).kind,'none');
  const edited=detectMissingThree({...input('Edited Idea 3\n\nImplement'),coverage:result.blocks});
  assert.equal(edited.kind,'found');if(edited.kind==='found')assert.equal(edited.markdown,'Edited Idea 3');
  const repeated=detectMissingThree({...input('Idea 3\n\nIdea 3\n\nImplement'),coverage:result.blocks});
  assert.equal(repeated.kind,'found');if(repeated.kind==='found')assert.equal(repeated.markdown,'Idea 3');
  assert.equal(detectMissingThree({...original,coverage:[]}).kind,'found');
});
test('whole lists, fences, paragraphs and partial selections stay valid Markdown',()=>{
  for(const passage of ['- Idea 3\n- Implement','```text\nIdea 3\nImplement\n```','Idea 3 then Implement']){
    const result=detectMissingThree(input(passage));assert.equal(result.kind,'found');
    if(result.kind==='found')assert.equal(result.markdown,passage);
  }
});
test('headings, copied responses, unavailable evidence and conflicting threads need a choice',()=>{
  assert.equal(detectMissingThree(input('# New topic\n\nIdea 3\n\nImplement')).kind,'uncertain');
  const copied=input();copied.document=`${response.body}\n\n${copied.document}`;
  const start=copied.document.lastIndexOf('Implement');copied.anchor=selectionAnchor(copied.document,'Implement',start,start+9);
  assert.equal(detectMissingThree(copied).kind,'uncertain');
  assert.equal(detectMissingThree({...input(),unavailable:true}).kind,'uncertain');
  assert.equal(detectMissingThree({...input(),threadId:'other-thread'}).kind,'uncertain');
  const modified=input();modified.responses=[{...response,body:'> Previous body'}];
  assert.equal(detectMissingThree(modified).kind,'uncertain');
});
test('arbitrary quotes and code literals are never response provenance',()=>{
  assert.equal(detectMissingThree({...input(),responses:[]}).kind,'none');
  assert.equal(detectMissingThree(input('```\n> Response 2\n```\n\nIdea 3\n\nImplement')).kind,'uncertain');
});
test('nearest preceding foreign response blocks an older same-thread boundary',()=>{
  const request=input('> Foreign reply\n\nIdea 3\n\nImplement');
  request.responses.push({...response,id:'foreign',threadId:'foreign',body:'> Foreign reply'});
  assert.equal(detectMissingThree(request).kind,'uncertain');
});
test('active verified replies work without changing steering or tracking markers',()=>{
  const region=initialRegion(id),document=`Idea 1\n${region.text}\nIdea 3\n\nImplement`;
  const start=document.lastIndexOf('Implement');
  // Obtain the exact region body, independent of initialRegion spacing.
  const body=region.text.slice(region.text.indexOf('-->')+4,region.text.lastIndexOf('\n<!--'));
  const verified=detectMissingThree({...input(),document,anchor:selectionAnchor(document,'Implement',start,start+9),responses:[{...response,body,active:true}]});
  assert.equal(verified.kind,'found');
});
test('lease provenance requires exact turn binding and durable completion cleanup proofs',()=>{
  const record:any={request:{...response,vaultId:'vault',notePath:'note.md',threadEnvironmentId:'env',messageId:'message'},state:{status:'complete',notePath:'note.md',messageId:'message',turnId:'turn',bindingCheckpoint:{bindings:{message:{turnId:'turn',kind:'explicit'}}},finalBody:response.body,responseAnchor:{length:8,hash:contentHash('Idea 1\n\n')},finalSaved:true,cleanupComplete:true}};
  assert.deepEqual(leaseResponseEvidence(record,'vault','note.md'),{...response,prefix:record.state.responseAnchor});
  for(const field of ['finalSaved','cleanupComplete'])assert.equal(leaseResponseEvidence({...record,state:{...record.state,[field]:false}},'vault','note.md'),undefined);
  assert.equal(leaseResponseEvidence({...record,state:{...record.state,turnId:'wrong'}},'vault','note.md'),undefined);
  assert.equal(leaseResponseEvidence(record,'vault','copied-note.md'),undefined);
  assert.deepEqual(leaseResponseEvidence(record,'vault','renamed.md','note.md'),{...response,prefix:record.state.responseAnchor});
});
test('missing images use the existing pipeline and are conservatively resent',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const request=input('Idea 3\n\n![[missing.png]]\n\nImplement');
  const result=detectMissingThree(request);assert.equal(result.kind,'found');
  if(result.kind!=='found')return;
  const prepared=await collectImages(withMissingThree(request.prompt,result.markdown),async()=>({bytes:png,name:'missing.png'}));
  assert.equal(prepared.attachments.length,1);assert.match(prepared.markdown,/Additional context[\s\S]*t3-context:[\s\S]*Your selected request:\nImplement/);
  const again=detectMissingThree({...request,coverage:result.blocks});assert.equal(again.kind,'found');if(again.kind==='found')assert.equal(again.markdown,'![[missing.png]]');
});
test('delivery records merge by request ID and retain distinct destination scopes',()=>{
  const a={id:'a',notePath:'note',threadId:'thread',projectId:'project',environmentId:'env',blocks:[]};
  assert.equal(mergeNoteDeliveries([a],[a,{...a,id:'b',threadId:'other'}]).length,2);
});

test('full-note delivery covers supplied user blocks without expanding the prompt',()=>{
  const first=input('Idea 3','Idea 3');
  const blocks=suppliedNoteBlocks(first);
  assert.equal(blocks[0].markdown,'Idea 3');
  assert.equal(detectMissingThree({...input(),coverage:blocks}).kind,'none');
});

test('a uniquely copied or moved completed reply fails its saved positional provenance',()=>{
  const request=input();request.responses=[{...response,prefix:{length:8,hash:contentHash('Idea 1\n\n')}}];
  assert.equal(detectMissingThree(request).kind,'found');
  const moved=input();moved.document=moved.document.replace('Idea 1','Changed prefix');
  const start=moved.document.lastIndexOf('Implement');moved.anchor=selectionAnchor(moved.document,'Implement',start,start+9);moved.responses=request.responses;
  assert.equal(detectMissingThree(moved).kind,'uncertain');
});
