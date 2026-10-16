import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {changedEdits} from './coordinated-merge';
import {endInsertionOffset} from './inline-thread';
import {responseBoundaries} from './response-container';

export interface CursorInsertion {document:string;offset:number}
const parser=unified().use(remarkParse);

/** A reply is a block. Keep a cursor between blocks, or move it past the
 * enclosing paragraph/container instead of splitting the user's Markdown. */
function blockInsertionOffset(document:string,cursor:number):number {
  if(!Number.isSafeInteger(cursor)||cursor<0||cursor>document.length)throw Error('The send cursor is no longer available.');
  let offset=cursor;
  const properties=/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(document);
  if(properties&&offset<properties[0].length)offset=properties[0].length;
  // Saved response markers and legacy response blocks must remain intact.
  const boundaries=responseBoundaries(document);
  for(const start of boundaries.filter(boundary=>boundary.kind==='start')){
    const end=boundaries.find(boundary=>boundary.kind==='end'&&boundary.id===start.id);
    if(end&&offset>start.from&&offset<end.to)offset=end.to;
  }
  for(const node of parser.parse(document).children){
    const from=node.position?.start.offset,to=node.position?.end.offset;
    if(from!==undefined&&to!==undefined&&offset>from&&offset<to){offset=to;break;}
  }
  return offset;
}

export function cursorInsertionOffset(document:string,cursor:number):number {
  const offset=blockInsertionOffset(document,cursor);
  // Reuse the existing fence guard, including refusal of an unclosed fence.
  endInsertionOffset(document.slice(0,offset));
  return offset;
}

export function captureCursorInsertion(document:string,cursor:number):CursorInsertion {
  // Capturing a hint must not prevent a send whose streaming option is Off.
  return {document,offset:blockInsertionOffset(document,cursor)};
}

/** Cursor movement never retargets a prepared send. Map unrelated note edits
 * conservatively; edits at the captured boundary require a new Send. */
export function resolveCursorInsertion(document:string,insertion:CursorInsertion):number {
  const edits=changedEdits(insertion.document,document),offset=insertion.offset;
  if(edits.some(edit=>edit.from<=offset&&edit.to>=offset))throw Error('The note changed at the send cursor. Send again from the desired position.');
  const shift=edits.filter(edit=>edit.to<offset).reduce((sum,edit)=>sum+edit.text.length-(edit.to-edit.from),0);
  return cursorInsertionOffset(document,offset+shift);
}
