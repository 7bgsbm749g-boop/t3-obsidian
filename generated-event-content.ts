import {changedEdits,mergeSavedEdits} from './coordinated-merge';
import {contentHash} from './completion';
import {finalizeRegion,regionBody} from './inline-thread';
import type {NoteGeneration} from './generated-note-coordinator';
import type {HostedInlineState} from './hosted-inline';
import {removeStreamBlock} from './stream-block';

/** Strip only ranges proven by immutable materialization intents. Map ordinary
 * edits outside those ranges; an edited/ambiguous generated range is user text. */
export function generatedEventContent(content:string,records:NoteGeneration[],legacy:HostedInlineState[]=[]):string {
  const ranges:Array<{from:number;to:number}>=[];
  for(const state of legacy){
    const anchor=state.responseAnchor,body=state.finalBody;
    if(!state.finalSaved||!anchor||body===undefined||anchor.length<1)continue;
    if(contentHash(content.slice(0,anchor.length))!==anchor.hash||content.slice(anchor.length,anchor.length+body.length)!==body)continue;
    const from=anchor.length-1,to=anchor.length+body.length+1;
    if(content[from]==='\n'&&content[to-1]==='\n')ranges.push({from,to});
  }
  for(const record of records){
    if(!record.attempt||record.finalBody===undefined||record.staged===undefined||record.status==='removed')continue;
    const region=regionBody(record.original,record.request.id);
    const final=region&&finalizeRegion(record.original,record.request.id,contentHash(region.body),record.finalBody);
    if(!final)continue;
    const merged=mergeSavedEdits(record.original,record.attempt.before,[...changedEdits(record.original,record.staged),final]);
    if(!merged.ok||merged.text!==record.attempt.expected)continue;
    const placed=merged.edits.at(-1)!;
    let from=placed.from+merged.edits.filter(edit=>edit.from<placed.from).reduce((delta,edit)=>delta+edit.text.length-(edit.to-edit.from),0),to=from+placed.text.length;
    let expected=record.attempt.expected,generated=placed.text;
    if(record.historyRemoval?.status==='verified'){
      const removal=removeStreamBlock(expected,record.historyRemoval.key,record.historyRemoval.blockHash);
      const map=(offset:number)=>offset<=removal.from?offset:offset>=removal.to?offset-(removal.to-removal.from):removal.from;
      from=map(from);to=map(to);expected=removal.text;
      generated=removeStreamBlock(generated,record.historyRemoval.key,record.historyRemoval.blockHash).text;
    }
    const expectedTo=to;
    const edits=changedEdits(expected,content);
    if(edits.some(edit=>edit.from<to&&edit.to>from||edit.from===edit.to&&edit.from>from&&edit.from<to))continue;
    const offset=edits.filter(edit=>edit.to<=from).reduce((delta,edit)=>delta+edit.text.length-(edit.to-edit.from),0);
    from+=offset;to+=offset;
    if(content.slice(from,to)!==generated)continue;
    // The anchor's terminating newline is inserted with the registration and
    // survives finalization. Match active-marker filtering without consuming
    // any additional ordinary whitespace.
    if(expected[expectedTo]==='\n'&&content[to]==='\n')to++;
    ranges.push({from,to});
  }
  const unique=ranges.sort((a,b)=>a.from-b.from).filter((range,i,all)=>!i||range.from>=all[i-1].to);
  for(const range of unique.reverse())content=content.slice(0,range.from)+content.slice(range.to);
  return content;
}
