/** Conservative three-way text merge. Offsets always refer to the original
 * saved document, never to a native view containing transient output. */
export interface SavedEdit {from:number;to:number;text:string}
export type MergeResult={ok:true;text:string;edits:SavedEdit[]}|{ok:false;reason:string};

/** A single changed interval deliberately treats separated edits as one area.
 * This can ask for resolution more often, but cannot guess at repeated text. */
export function changedInterval(before:string,after:string):SavedEdit|undefined {
  if(before===after)return;
  let from=0,to=before.length,end=after.length;
  while(from<to&&from<end&&before[from]===after[from])from++;
  while(to>from&&end>from&&before[to-1]===after[end-1]){to--;end--;}
  return {from,to,text:after.slice(from,end)};
}

export function applySavedEdits(original:string,edits:readonly SavedEdit[]):string {
  const ordered=[...edits].sort((a,b)=>a.from-b.from||a.to-b.to);
  let end=-1;
  for(const edit of ordered){
    if(!Number.isSafeInteger(edit.from)||!Number.isSafeInteger(edit.to)||edit.from<0||edit.to<edit.from||edit.to>original.length||edit.from<=end)throw Error('Invalid or overlapping saved-note edits.');
    end=edit.to;
  }
  let text=original;
  for(const edit of ordered.reverse())text=text.slice(0,edit.from)+edit.text+text.slice(edit.to);
  return text;
}

export function mergeSavedEdits(original:string,latest:string,proposed:readonly SavedEdit[]):MergeResult {
  // Validate before considering an intervening edit.
  applySavedEdits(original,proposed);
  const user=changedInterval(original,latest);
  if(!user)return {ok:true,text:applySavedEdits(original,proposed),edits:[...proposed]};
  const delta=user.text.length-(user.to-user.from),mapped:SavedEdit[]=[];
  for(const edit of proposed){
    // Touching insertions and replacements are ambiguous. Avoid ordering them
    // based on arrival time, including edits exactly at a response boundary.
    if(!(edit.to<user.from||edit.from>user.to))return {ok:false,reason:'Generated and ordinary edits overlap or touch. Both versions are preserved.'};
    const shift=edit.from>user.to?delta:0;
    mapped.push({from:edit.from+shift,to:edit.to+shift,text:edit.text});
  }
  return {ok:true,text:applySavedEdits(latest,mapped),edits:mapped};
}
