import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changedInterval,mergeSavedEdits,applySavedEdits} from '../coordinated-merge';
test('conservative three-way merge preserves compatible edits before and after a staged patch',()=>{
  const original='Head\n\n| 20kg |\n\nTail',staged=original.replace('20kg','25kg'),edit=changedInterval(original,staged)!;
  for(const latest of [original.replace('Head','User head'),original.replace('Tail','User tail')]){
    const merged=mergeSavedEdits(original,latest,[edit]);assert.equal(merged.ok,true);if(merged.ok)assert.equal(merged.text,latest.replace('20kg','25kg'));
  }
});
test('overlap, adjacent insertion and malformed offsets do not guess at a merge',()=>{
  const original='abcdef';assert.equal(mergeSavedEdits(original,'abUSERef',[{from:2,to:4,text:'AGENT'}]).ok,false);
  assert.equal(mergeSavedEdits(original,'abUSERcdef',[{from:2,to:2,text:'AGENT'}]).ok,false);
  assert.throws(()=>applySavedEdits(original,[{from:2,to:4,text:'one'},{from:3,to:5,text:'two'}]),/overlapping/);
  assert.throws(()=>applySavedEdits(original,[{from:0,to:8,text:''}]),/Invalid/);
});

test('unique unchanged line anchors prove independent ordinary edits on both sides of a generated patch',()=>{
 const original='Before\n\nUnique left\n\nTable 20\n\nUnique right\n\nAfter\n';
 const latest=original.replace('Before','User before').replace('After','User after');const at=original.indexOf('Table 20');
 const result=mergeSavedEdits(original,latest,[{from:at,to:at+8,text:'Table 25'}]);assert.equal(result.ok,true);if(result.ok)assert.equal(result.text,latest.replace('Table 20','Table 25'));
});
