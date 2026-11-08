type Path=readonly (string|number)[];
interface Frame {kind:'object'|'array';path:Path;skip:boolean;state:'key'|'colon'|'value'|'after';key?:string;index:number;count:number}

/** Select JSON fields while chunks arrive. Ignored strings and containers are
 * scanned, never accumulated; retained values keep their exact JSON encoding. */
export class StreamingJson {
 private frames:Frame[]=[];private parts:string[]=[];private root=false;
 private string?:{key:boolean;keep:boolean;parts:string[]};
 private escape=false;private unicode=0;
 private primitive?:{keep:boolean;parts:string[]};
 private characters=0;
 constructor(private omit:(path:Path)=>boolean=()=>false){}
 get retainedCharacters(){return this.characters;}
 private emit(text:string){if(text){this.parts.push(text);this.characters+=text.length;}}
 private fail():never{throw Error('T3 returned an invalid response; response contents withheld.');}
 private begin(){
  const frame=this.frames.at(-1);let path:Path=[],skip=false;
  if(frame){
   if(frame.state!=='value')this.fail();
   path=[...frame.path,frame.kind==='object'?frame.key!:frame.index];
   skip=frame.skip||this.omit(path);
   if(!skip){if(frame.count++)this.emit(',');if(frame.kind==='object')this.emit(JSON.stringify(frame.key)+':');}
   frame.state='after';
  }else {if(this.root)this.fail();this.root=true;}
  return {path,skip};
 }
 private endPrimitive(){
  const token=this.primitive!;this.primitive=undefined;
  try{JSON.parse(token.parts.join(''));}catch{this.fail();}
 }
 write(text:string){
  let at=0;
  while(at<text.length){
   const string=this.string;
   if(string){
    const start=at;
    while(at<text.length){
     const char=text[at++],code=char.charCodeAt(0);
     if(this.unicode){if(!/[\da-f]/i.test(char))this.fail();this.unicode--;continue;}
     if(this.escape){this.escape=false;if(char==='u')this.unicode=4;else if(!'"\\/bfnrt'.includes(char))this.fail();continue;}
     if(code<32)this.fail();
     if(char==='\\'){this.escape=true;continue;}
     if(char==='"'){
      const span=text.slice(start,at);
      if(string.key){string.parts.push(span);const frame=this.frames.at(-1)!;try{const key:unknown=JSON.parse(string.parts.join(''));if(typeof key!=='string')this.fail();frame.key=key;}catch{this.fail();}frame.state='colon';}
      else if(string.keep)this.emit(span);
      this.string=undefined;break;
     }
    }
    if(this.string){const span=text.slice(start,at);if(string.key)string.parts.push(span);else if(string.keep)this.emit(span);}
    continue;
   }
   if(this.primitive){
    const start=at;while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;
    const span=text.slice(start,at);this.primitive.parts.push(span);if(this.primitive.keep)this.emit(span);
    if(at<text.length)this.endPrimitive();else break;
    continue;
   }
   const char=text[at++],frame=this.frames.at(-1);
   if(/[ \t\r\n]/.test(char))continue;
   if(char===','||char===':'){
    if(!frame)this.fail();
    if(char===':'){if(frame.kind!=='object'||frame.state!=='colon')this.fail();frame.state='value';}
    else {if(frame.state!=='after')this.fail();frame.state=frame.kind==='object'?'key':'value';frame.index++;}
    continue;
   }
   if(char==='}'||char===']'){
    if(!frame||frame.kind!==(char==='}'?'object':'array')||frame.state==='colon'||frame.state==='value'&&frame.kind==='object'||frame.state==='key'&&frame.index>0||frame.state==='value'&&frame.kind==='array'&&frame.index>0)this.fail();
    this.frames.pop();if(!frame.skip)this.emit(char);continue;
   }
   if(char==='"'&&frame?.kind==='object'&&frame.state==='key'){
    this.string={key:true,keep:false,parts:['"']};continue;
   }
   const value=this.begin();
   if(char==='{'||char==='['){
    if(!value.skip)this.emit(char);
    this.frames.push({kind:char==='{'?'object':'array',path:value.path,skip:value.skip,state:char==='{'?'key':'value',index:0,count:0});
   }else if(char==='"'){
    if(!value.skip)this.emit(char);this.string={key:false,keep:!value.skip,parts:[]};
   }else {
    if(!/[\d\-tfn]/.test(char))this.fail();
    if(!value.skip)this.emit(char);this.primitive={keep:!value.skip,parts:[char]};
   }
  }
 }
 finish():unknown{
  if(this.primitive)this.endPrimitive();
  if(!this.root||this.frames.length||this.string)this.fail();
  try{return JSON.parse(this.parts.join(''));}catch{this.fail();}
 }
}

const importFields=new Set(['thread','runs','messages','turnItems','visibleTurnItems','runtimeRequests']);
/** Run imports need canonical messages and control evidence, not the complete
 * subagent tree or tool inputs. Live response reads keep their full shape. */
export function omitImportField(path:Path){
 if(path[0]==='projection'&&path.length===2)return !importFields.has(String(path[1]));
 return (path[0]==='projection'||path[0]==='items')&&['context','input'].includes(String(path.at(-1)));
}
