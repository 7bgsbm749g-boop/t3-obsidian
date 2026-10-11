import type {LeaseRecord} from './inline-lease';
import {retainedLease,isCompletedLeaseIndex} from './completed-lease-index';
import {contentHash} from './completion';

type Entry={raw?:string;hash?:string;record:LeaseRecord;objects:number;characters:number};

/** Read-only discovery snapshots. Callers must read fresh storage bytes first;
 * this cache only avoids decoding those exact bytes again. Authority writes
 * continue to parse their own mutable records and apply their normal fences. */
export class LeaseRecordCache {
  private entries=new Map<string,Entry>();
  private characters=0;
  private objects=0;
  private hits=0;
  private parses=0;
  constructor(private maxCharacters=16_000_000,private maxEntries=1024,private maxObjects=65_536){}
  status(){return {entries:this.entries.size,characters:this.characters,objects:this.objects,maxCharacters:this.maxCharacters,maxEntries:this.maxEntries,maxObjects:this.maxObjects,hits:this.hits,parses:this.parses};}
  remove(path:string){const old=this.entries.get(path);if(old){this.characters-=old.characters;this.objects-=old.objects;this.entries.delete(path);}}
  retain(paths:ReadonlySet<string>){for(const path of this.entries.keys())if(!paths.has(path))this.remove(path);}
  clear(){this.entries.clear();this.characters=0;this.objects=0;}
  read(path:string,raw:string):LeaseRecord {
    const old=this.entries.get(path);
    if(old&&(old.raw===raw||old.hash!==undefined&&old.hash===contentHash(raw))){this.entries.delete(path);this.entries.set(path,old);this.hits++;return old.record;}
    this.remove(path);this.parses++;
    const record=retainedLease(JSON.parse(raw)),pending:unknown[]=[record,...Object.getOwnPropertySymbols(record).map(key=>(record as any)[key])];let objects=0;
    while(pending.length){
      const value=pending.pop();if(value===null||typeof value!=='object')continue;
      objects++;for(const child of Object.values(value))pending.push(child);Object.freeze(value);
    }
    // Discovery walks the whole directory in a stable order. Evicting a warm
    // entry for every cold miss would make an oversized scan miss forever.
    // Keep already admitted exact snapshots; removed/changed files free space.
    const compact=isCompletedLeaseIndex(record),characters=compact?JSON.stringify(record).length+JSON.stringify(Object.getOwnPropertySymbols(record).map(key=>(record as any)[key])).length:raw.length;
    if(this.entries.size<this.maxEntries&&this.characters+characters<=this.maxCharacters&&this.objects+objects<=this.maxObjects){
      this.entries.set(path,{...(compact?{hash:contentHash(raw)}:{raw}),record,objects,characters});this.characters+=characters;this.objects+=objects;
    }
    return record;
  }
}
