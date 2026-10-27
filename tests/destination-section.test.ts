import {test} from 'node:test';
import assert from 'node:assert/strict';
import {destinationOffset} from '../destination-section';
import {editorStream} from '../editor-stream';
import {responseAnchor} from '../native-response-projection';
import {randomUUID} from 'node:crypto';
import {nativeRequest} from './fixtures/native-message';
test('section placement stays within a unique heading, ignores code and preserves unrelated sections on retry',async()=>{
 const id=randomUUID();let document='# Jobs\n\n## CURRENT JOB\nOrdinary edit\n\n### Nested\nKeep\n\n## NEXT\nUnrelated tail\n';
 const source={...nativeRequest(),id,notePath:'Any.md',destinationSection:'CURRENT JOB'};
 const io={updateNote:async(_path:string,change:(current:string)=>string)=>document=change(document)};
 const binding=await editorStream(source,'Any.md',io,()=>true);assert.ok(document.indexOf(responseAnchor(binding.id))<document.indexOf('## NEXT'));assert.ok(document.endsWith('## NEXT\nUnrelated tail\n'));const first=document;
 await editorStream(source,'Any.md',io,()=>true);assert.equal(document,first);
 assert.throws(()=>destinationOffset('## Same\n\n## Same\n','Same'),/ambiguous/);
 assert.throws(()=>destinationOffset('```md\n## Same\n```\n','Same'),/missing/);
});
