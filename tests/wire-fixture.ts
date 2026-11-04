import assert from 'node:assert/strict';
import {isRecord} from '../src/shared/values';
import {readThreadSnapshot,type NormalizedThread,type ThreadSnapshot} from '../src/connection/wire-types';
export function expectRecord(value:unknown):Record<string,unknown>{assert.ok(isRecord(value),'Expected a protocol object');return value;}
export function expectProject(value:unknown):{id:string}{const record=expectRecord(value);assert.equal(typeof record.id,'string');return record as {id:string};}
/** Full detail fixtures exercise the complete normalized display contract. */
export function expectSnapshot(value:unknown):ThreadSnapshot&{page:{hasMore:boolean};thread:NormalizedThread&{turns:NonNullable<NormalizedThread['turns']>;session:NonNullable<NormalizedThread['session']>}}{
 const snapshot=readThreadSnapshot(value);assert.equal(typeof snapshot.page?.hasMore,'boolean');assert.ok(snapshot.thread.turns);assert.ok(snapshot.thread.session);
 return snapshot as ThreadSnapshot&{page:{hasMore:boolean};thread:NormalizedThread&{turns:NonNullable<NormalizedThread['turns']>;session:NonNullable<NormalizedThread['session']>}};
}
