import {cursorInsertionOffset} from './cursor-insertion';
import {responseAnchor,responseRegion} from './native-response-projection';
import {localResponseRange} from './local-response-binding';
import type {StateEffectType,Extension,Transaction,TransactionSpec} from '@codemirror/state';
import {applySavedEdits,type SavedEdit} from './coordinated-merge';

export interface ResponseMove {id:string;key:string;before:string;after:string;edits:SavedEdit[];inverse:SavedEdit[]}
let effect:StateEffectType<ResponseMove>|undefined;
export function responseMoveEffect(){
  const {StateEffect}=require('@codemirror/state') as typeof import('@codemirror/state');
  return effect??=StateEffect.define<ResponseMove>();
}
/** History stores saved anchors, not a version of a growing response body.
 * Undo/redo are rechecked against the current response and saved note. */
export function responseMoveHistory():Extension {
  const {invertedEffects}=require('@codemirror/commands') as typeof import('@codemirror/commands');
  return invertedEffects.of(transaction=>transaction.effects.filter(item=>item.is(responseMoveEffect())).map(item=>responseMoveEffect().of({...item.value,before:item.value.after,after:item.value.before,edits:item.value.inverse,inverse:item.value.edits})));
}
type MoveHandler=(transaction:Transaction,move:ResponseMove)=>TransactionSpec|undefined;
const dispatchers=new WeakMap<object,{handler?:MoveHandler}>();
/** Native history deliberately skips transaction filters. A move is recorded
 * as an effect-only history step, then its current projection is applied as a
 * separate non-history update. No streamed body enters a move history event.
 * A detached owner consumes old move steps without changing the document. */
export function guardResponseMoveHistory(cm:any,handler:MoveHandler):()=>void {
  let owned=dispatchers.get(cm);
  if(!owned){
    owned={};dispatchers.set(cm,owned);const state=owned,original=cm.dispatch;
    cm.dispatch=function(...args:any[]){
      const transactions=args.length===1&&Array.isArray(args[0])?args[0]:args;
      if(transactions.every((tr:any)=>tr?.startState)&&transactions.some((tr:Transaction)=>tr.effects.some(item=>item.is(responseMoveEffect())))){
        for(const transaction of transactions){
          const move=transaction.effects.find((item:any)=>item.is(responseMoveEffect()));
          if(move&&transaction.startState===cm.state){
            const update=state.handler?.(transaction,move.value);
            original.call(cm,transaction);
            if(update)original.call(cm,cm.state.update(update));
          }else original.call(cm,transaction);
        }
      }else original.apply(cm,args);
    };
  }
  owned.handler=handler;
  return ()=>{if(owned!.handler===handler)owned!.handler=undefined;};
}

/** Move the exact saved container (and any legacy binding descriptor) in one
 * note. Existing ordinary bytes remain intact; new separators keep it a block. */
export function movedResponse(document:string,id:string,cursor:number):{text:string;offset:number;edits:SavedEdit[];inverse:SavedEdit[]}|undefined {
  const region=responseRegion(document,id);
  if(!region||document.slice(region.from,region.to)!==responseAnchor(id,document))throw Error('The active response changed before it could be moved.');
  const range=localResponseRange(document,id)??region;
  if(cursor>=range.from&&cursor<=range.to)return;
  const target=cursorInsertionOffset(document,cursor);
  if(target>=range.from&&target<=range.to)return;
  const block=document.slice(range.from,range.to),without=document.slice(0,range.from)+document.slice(range.to);
  const at=target>range.to?target-(range.to-range.from):target;
  const before=without.slice(0,at),after=without.slice(at);
  const prefix=!before||/\n[ \t]*\n[ \t]*$/.test(before)?'':before.endsWith('\n')?'\n':'\n\n';
  const suffix=after.startsWith('\n\n')?'':after.startsWith('\n')?'\n':'\n\n';
  const edits:SavedEdit[]=[{from:range.from,to:range.to,text:'',preserveBoundaryInsertions:true},{from:target,to:target,text:prefix+block+suffix}].sort((a,b)=>a.from-b.from);
  const text=applySavedEdits(document,edits),inverse:SavedEdit[]=[];let shift=0;
  for(const edit of edits){inverse.push({from:edit.from+shift,to:edit.from+shift+edit.text.length,text:document.slice(edit.from,edit.to),preserveBoundaryInsertions:edit.text.length>0});shift+=edit.text.length-(edit.to-edit.from);}
  const moved=responseRegion(text,id);
  if(!moved||text.slice(moved.from,moved.to)!==responseAnchor(id,text))throw Error('Choose a position outside Markdown code and other responses.');
  return {text,offset:target,edits,inverse};
}
