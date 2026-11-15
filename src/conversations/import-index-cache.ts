import type {ThreadSnapshot} from '../connection/wire-types';
import type {ImportRun} from './run-import';
import {logEvent} from '../app/diagnostics';

interface Entry {identity:object;threadId:string;projectId:string;revision:string;runs:ImportRun[];characters:number}
/** Retain only completed reads. The caller checks an authenticated stock
 * revision before every hit; checked saving never uses this cache. The budget
 * evicts optional cached data and does not limit any foreground import. */
export class ImportIndexCache {
 private entries:Entry[]=[];private characters=0;
 constructor(private maxEntries=8,private maxCharacters=16_000_000){}
 private remove(index:number){const [entry]=this.entries.splice(index,1);if(entry)this.characters-=entry.characters;}
 delete(identity:object,threadId:string){const index=this.entries.findIndex(entry=>entry.identity===identity&&entry.threadId===threadId);if(index>=0)this.remove(index);}
 read(identity:object,threadId:string,projectId:string,revision:string){
  const index=this.entries.findIndex(entry=>entry.identity===identity&&entry.threadId===threadId);if(index<0){logEvent('import.index.cache',{threadId,result:'miss'});return;}
  const entry=this.entries[index];
  if(entry.projectId!==projectId||entry.revision!==revision){this.remove(index);logEvent('import.index.cache',{threadId,result:'changed'});return;}
  logEvent('import.index.cache',{threadId,result:'hit',characters:entry.characters});
  this.entries.splice(index,1);this.entries.push(entry);return entry.runs.slice();
 }
 remember(identity:object,threadId:string,projectId:string,revision:string,runs:ImportRun[],snapshot:ThreadSnapshot){
  this.delete(identity,threadId);if(snapshot.page?.hasMore)return;
  const characters=JSON.stringify(snapshot).length;if(characters>this.maxCharacters){logEvent('import.index.cache',{threadId,result:'not-retained',characters});return;}
  this.entries.push({identity,threadId,projectId,revision,runs:runs.slice(),characters});this.characters+=characters;
  while(this.entries.length>this.maxEntries||this.characters>this.maxCharacters)this.remove(0);
  logEvent('import.index.cache',{threadId,result:'retained',characters,totalCharacters:this.characters});
 }
}
