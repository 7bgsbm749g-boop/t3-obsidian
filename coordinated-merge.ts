/** Conservative three-way text merge. Offsets always refer to the original
 * saved document, never to a native view containing transient output. */
export interface SavedEdit {from:number;to:number;text:string;preserveBoundaryInsertions?:boolean}
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

/** Split only at unchanged lines that occur exactly once in both versions.
 * Reordered or repeated anchors fall back to one conservative interval. */
export function changedEdits(before:string,after:string):SavedEdit[]{
  if(before===after)return [];
  const lines=(text:string)=>{let offset=0;return (text.match(/[^\n]*\n|[^\n]+$/g)??[]).map(text=>{const line={text,from:offset};offset+=text.length;return line;});};
  const left=lines(before),right=lines(after),count=(items:typeof left)=>{const counts=new Map<string,number>();for(const line of items)counts.set(line.text,(counts.get(line.text)??0)+1);return counts;};
  const a=count(left),b=count(right),rightByText=new Map(right.map(line=>[line.text,line]));
  const anchors=left.filter(line=>line.text.trim()&&a.get(line.text)===1&&b.get(line.text)===1).map(line=>({left:line,right:rightByText.get(line.text)!}));
  if(anchors.some((anchor,index)=>index&&anchor.right.from<anchors[index-1].right.from))return [changedInterval(before,after)!];
  const edits:SavedEdit[]=[];let l=0,r=0;
  for(const anchor of [...anchors,{left:{from:before.length,text:''},right:{from:after.length,text:''}}]){
    const edit=changedInterval(before.slice(l,anchor.left.from),after.slice(r,anchor.right.from));if(edit)edits.push({...edit,from:edit.from+l,to:edit.to+l});
    l=anchor.left.from+anchor.left.text.length;r=anchor.right.from+anchor.right.text.length;
  }
  return edits;
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
  // Text on BOTH outer edges changes both marker lines. The normal line diff
  // then treats the whole unchanged response as one replacement. An exact,
  // unique checked response preimage supplies a stronger unchanged anchor.
  const anchors=proposed.filter(edit=>edit.preserveBoundaryInsertions&&edit.to>edit.from).flatMap(edit=>{
    const text=original.slice(edit.from,edit.to),at=latest.indexOf(text);
    return original.indexOf(text)===edit.from&&original.lastIndexOf(text)===edit.from&&at>=0&&latest.lastIndexOf(text)===at?[{from:edit.from,to:edit.to,at,end:at+text.length}]:[];
  }).sort((a,b)=>a.from-b.from);
  let users:SavedEdit[];
  if(anchors.length&&!anchors.some((anchor,index)=>index&&(anchor.from<anchors[index-1].to||anchor.at<anchors[index-1].end))){
    users=[];let l=0,r=0;
    for(const anchor of [...anchors,{from:original.length,to:original.length,at:latest.length,end:latest.length}]){
      users.push(...changedEdits(original.slice(l,anchor.from),latest.slice(r,anchor.at)).map(edit=>({...edit,from:edit.from+l,to:edit.to+l})));
      l=anchor.to;r=anchor.end;
    }
  }else users=changedEdits(original,latest);
  if(!users.length)return {ok:true,text:applySavedEdits(original,proposed),edits:[...proposed]};
  const mapped:SavedEdit[]=[];
  for(const edit of proposed){
    // A checked response replacement owns the comment pair, but ordinary
    // insertions exactly outside that pair belong before/after the result.
    // Other staged edits retain the conservative touching-edit rule.
    const outside=(user:SavedEdit)=>edit.preserveBoundaryInsertions===true&&user.from===user.to&&(user.from===edit.from||user.from===edit.to);
    // A native pane can echo an independently registered anchor (or an
    // ordinary edit) already included in the incoming saved revision. Exact
    // identical edits are one change, not competing changes. Other touching
    // edits still require resolution.
    if(users.some(user=>user.from===edit.from&&user.to===edit.to&&user.text===edit.text))continue;
    // Touching insertions and replacements are ambiguous. Avoid ordering them
    // based on arrival time, including edits exactly at a response boundary.
    if(users.some(user=>!(edit.to<user.from||edit.from>user.to)&&!outside(user)))return {ok:false,reason:'Generated and ordinary edits overlap or touch. Both versions are preserved.'};
    const shift=users.filter(user=>edit.from>user.to||outside(user)&&user.to===edit.from).reduce((delta,user)=>delta+user.text.length-(user.to-user.from),0);
    mapped.push({from:edit.from+shift,to:edit.to+shift,text:edit.text});
  }
  return {ok:true,text:applySavedEdits(latest,mapped),edits:mapped};
}
