import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ResponseNoteLocator} from '../src/responses/response-location';
import {responseAnchor} from '../src/responses/native-response-projection';
import {contentHash} from '../src/responses/completion';
function fixture(){const id=randomUUID(),notes=new Map([['Old.md',responseAnchor(id)]]);let reads=0;const locator=new ResponseNoteLocator(()=>{throw Error('Vault enumeration is forbidden');},async path=>{reads++;return notes.get(path);});return {id,notes,locator,reads:()=>reads};}
test('observed file and folder moves keep exact bindings without enumerating notes',async()=>{
 const f=fixture();await f.locator.locate(f.id,'Old.md');f.notes.set('Folder/Note.md',f.notes.get('Old.md')!);f.notes.delete('Old.md');f.locator.renamed('Old.md','Folder/Note.md');
 assert.equal(await f.locator.locate(f.id,'Folder/Note.md'),'Folder/Note.md');f.notes.set('Moved/Note.md',f.notes.get('Folder/Note.md')!);f.notes.delete('Folder/Note.md');f.locator.renamed('Folder','Moved');assert.equal(await f.locator.locate(f.id,'Moved/Note.md'),'Moved/Note.md');
});
test('missed moves wait for explicit recovery; an unrelated replacement reaches the conflict guard',async()=>{
 const f=fixture();f.notes.set('Hidden/Note.md',f.notes.get('Old.md')!);f.notes.delete('Old.md');assert.equal(await f.locator.locate(f.id,'Old.md'),undefined);assert.equal(f.reads(),1);f.notes.set('Old.md','User replacement');assert.equal(await f.locator.locate(f.id,'Old.md'),'Old.md');assert.equal(f.notes.get('Old.md'),'User replacement');
});
test('observed duplicates stop writes until the extra copy is removed',async()=>{
 const f=fixture();await f.locator.locate(f.id,'Old.md');f.notes.set('Copy.md',f.notes.get('Old.md')!);f.locator.changed('Copy.md');await assert.rejects(f.locator.locate(f.id,'Old.md'),/multiple notes/);f.notes.delete('Copy.md');f.locator.deleted('Copy.md');assert.equal(await f.locator.locate(f.id,'Old.md'),'Old.md');
});
test('a verified relocation waits for its exact destination and excludes only the recorded stale bytes',async()=>{
 const f=fixture(),original=f.notes.get('Old.md')!;await f.locator.locate(f.id,'Old.md');f.locator.relocated(f.id,'Old.md','New.md',contentHash(original));assert.equal(await f.locator.locate(f.id,'Old.md'),undefined);f.notes.set('New.md',original);assert.equal(await f.locator.locate(f.id,'Old.md'),'New.md');f.notes.set('Old.md',original+'User changed copy');f.locator.changed('Old.md');await assert.rejects(f.locator.locate(f.id,'Old.md'),/multiple notes/);
});
test('many missing bindings read only their exact paths',async()=>{const f=fixture();for(let i=0;i<30;i++)await f.locator.locate(randomUUID(),'Missing.md');assert.equal(f.reads(),30);});
