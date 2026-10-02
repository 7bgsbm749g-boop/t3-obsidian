import {markdownCodeRanges} from './reply-html';
import {safeNotePath} from './hosted-inline';

/** Locations are hints; a binding's Markdown markers are its identity. The
 * recovery scan is shared and throttled, while observed edits update the index. */
export class ResponseNoteLocator {
  private notes=new Map<string,Set<string>>();
  private dirty=new Set<string>();
  private scan?:Promise<void>;
  private scannedAt=-Infinity;
  private recoveryDelay=60000;
  private known=new Set<string>();
  constructor(private paths:()=>string[],private read:(path:string)=>Promise<string|undefined>,private now=()=>Date.now()){}
  remember(path:string,document:string|undefined){
    this.dirty.delete(path);
    if(document===undefined){this.notes.delete(path);return;}
    const matches=[...document.matchAll(/^<!-- (?:t3-inline|t3-response):start:([0-9a-f-]{36}) -->$/gm)];
    const code=matches.length?markdownCodeRanges(document):[];
    const ids=new Set(matches.filter(match=>!code.some(([from,to])=>match.index!>=from&&match.index!<to)).map(match=>match[1]));
    if(ids.size)this.notes.set(path,ids);else this.notes.delete(path);
  }
  changed(path:string){if(safeNotePath(path))this.dirty.add(path);}
  deleted(path:string){for(const key of [...this.notes.keys(),...this.dirty])if(key===path||key.startsWith(path+'/')){this.notes.delete(key);this.dirty.delete(key);}}
  renamed(before:string,after:string){
    for(const [path,ids] of [...this.notes])if(path===before||path.startsWith(before+'/')){
      const next=after+path.slice(before.length);this.notes.delete(path);this.notes.set(next,ids);this.dirty.add(next);
    }
    this.deleted(before);this.changed(after);
  }
  private async refresh(path:string){const document=await this.read(path);this.remember(path,document);return document;}
  private async refreshDirty(){await Promise.all([...this.dirty].map(path=>this.refresh(path)));}
  private candidates(id:string){return [...this.notes].filter(([,ids])=>ids.has(id)).map(([path])=>path);}
  private async recover(){
    if(this.scan)return this.scan;
    const paths=this.paths().filter(safeNotePath),existing=new Set(paths);
    const full=this.now()-this.scannedAt>=this.recoveryDelay;
    const pending=full?paths:paths.filter(path=>!this.known.has(path));
    for(const path of this.known)if(!existing.has(path)){this.known.delete(path);this.notes.delete(path);}
    if(!pending.length&&!full)return;
    const work=(async()=>{
      // Observed changes are refreshed immediately; missed events get a shared
      // fallback sweep with backoff instead of a full-vault read every 3s.
      for(let index=0;index<pending.length;index+=16)await Promise.all(pending.slice(index,index+16).map(async path=>{
        await this.refresh(path);this.known.add(path);
      }));
      if(full){this.scannedAt=this.now();this.recoveryDelay=Math.min(300000,this.recoveryDelay*2);}
    })();this.scan=work;
    try{await work;}finally{this.scan=undefined;}
  }
  async locate(id:string,preferred:string):Promise<string|undefined>{
    const document=await this.refresh(preferred);
    await this.refreshDirty();
    let paths=this.candidates(id);
    if(paths.includes(preferred)&&paths.length>1){for(const path of paths)if(path!==preferred)await this.refresh(path);paths=this.candidates(id);}
    if(!paths.includes(preferred)){
      for(const path of paths)await this.refresh(path);
      paths=this.candidates(id);
      // A cached copy alone is not sufficient when the original disappeared:
      // find all matches before choosing a relocated destination.
      await this.recover();paths=this.candidates(id);
    }
    if(paths.length>1)throw Error('This response block appears in multiple notes. Remove the duplicate block to resume streaming.');
    if(paths.length)return paths[0];
    // An existing note with a removed/edited block must still reach the writer's
    // conflict guard. A missing file is a temporary move/Sync wait, not conflict.
    return document===undefined?undefined:preferred;
  }
}
