import type {ExplorerResponse,NoteIndicator} from './explorer-responses';

export interface CompletionReceipt {id:string;completionId:string;notePath:string;viewed:boolean;deleted?:boolean}
/** Device-local attention state. Run status remains owned by the response. */
export class CompletionGlow {
  private receipts=new Map<string,CompletionReceipt>();
  private viewing?:{path:string;since:number};
  constructor(saved:unknown,private save:(receipts:CompletionReceipt[])=>void){
    if(Array.isArray(saved))for(const value of saved)if(value&&typeof value.id==='string'&&typeof value.completionId==='string'&&typeof value.notePath==='string'&&typeof value.viewed==='boolean'&&(value.deleted===undefined||typeof value.deleted==='boolean'))this.receipts.set(value.id,{...value});
  }
  private persist(){this.save([...this.receipts.values()]);}
  observe(responses:ExplorerResponse[]):void {
    let changed=false;
    for(const response of responses){
      if(response.deleted||!response.complete||response.active||response.input)continue;
      const completionId=response.completionId??response.id,old=this.receipts.get(response.id);
      if(old?.completionId===completionId)continue;
      this.receipts.set(response.id,{id:response.id,completionId,notePath:response.notePath,viewed:false});changed=true;
      if(this.viewing?.path===response.notePath)this.viewing=undefined;
    }
    if(changed)this.persist();
  }
  /** Only a focused, visible note counts; background tabs never acknowledge. */
  view(path:string|undefined,now=Date.now()):void {
    if(!path){this.viewing=undefined;return;}
    if(this.viewing?.path!==path){this.viewing={path,since:now};return;}
    if(now-this.viewing.since<750)return;
    let changed=false;
    for(const receipt of this.receipts.values())if(!receipt.deleted&&!receipt.viewed&&receipt.notePath===path){receipt.viewed=true;changed=true;}
    if(changed)this.persist();
  }
  project(notes:Map<string,NoteIndicator>,exists:(path:string)=>boolean):Map<string,NoteIndicator> {
    const result=new Map(notes);
    for(const receipt of this.receipts.values())if(!receipt.viewed&&!receipt.deleted&&exists(receipt.notePath)){
      const note=result.get(receipt.notePath)??{active:0,input:0,complete:1,total:1};
      result.set(receipt.notePath,{...note,unread:(note.unread??0)+1});
    }
    return result;
  }
  relocate(before:string,after?:string):void {
    let changed=false;
    for(const receipt of this.receipts.values())if(receipt.notePath===before||receipt.notePath.startsWith(before+'/')){
      if(after===undefined)receipt.deleted=true;
      else receipt.notePath=after+receipt.notePath.slice(before.length);
      changed=true;
    }
    if(changed)this.persist();
  }
}

export function unreadCompletionFolders(notes:Map<string,NoteIndicator>):Set<string> {
  const folders=new Set<string>();
  for(const [path,note] of notes)if(note.unread){
    let at=path.lastIndexOf('/');
    while(at>0){folders.add(path.slice(0,at));at=path.lastIndexOf('/',at-1);}
  }
  return folders;
}
