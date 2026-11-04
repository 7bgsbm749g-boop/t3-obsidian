import {promises as fs,type BigIntStats} from 'node:fs';

type Entry={identity:BigIntStats;value:string};
const sameIdentity=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.mode===b.mode;

/** A fresh regular-file identity can verify an already decoded snapshot
 * without allocating its full text again. Symlinks cannot authenticate the
 * target bytes; they always retain ordinary fresh-read behavior. */
export async function inlineFileVersion(path:string):Promise<string|undefined>{
  try{const stat=await fs.lstat(path,{bigint:true});return stat.isFile()?[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,stat.mode].join(':'):undefined;}
  catch(error:any){if(error.code==='ENOENT')return;throw error;}
}

/** Only reuse bytes after a fresh nanosecond file-identity check. This cache
 * is private to this plugin process, bounded, and never persisted to a vault. */
export class DesktopInlineReadCache {
  private entries=new Map<string,Entry>();
  private characters=0;
  private hits=0;
  private sourceReads=0;
  constructor(private maxCharacters=16_000_000,private maxEntries=4096,private readFile=(path:string)=>fs.readFile(path,'utf8')){}
  status(){return {entries:this.entries.size,characters:this.characters,maxCharacters:this.maxCharacters,maxEntries:this.maxEntries,hits:this.hits,sourceReads:this.sourceReads};}
  invalidate(path:string){const old=this.entries.get(path);if(old){this.characters-=old.value.length;this.entries.delete(path);}}
  async read(path:string,retain=true):Promise<string|undefined>{
    if(!retain)this.invalidate(path);
    let before:BigIntStats;
    try{before=await fs.lstat(path,{bigint:true});}catch(error:any){this.invalidate(path);if(error.code==='ENOENT')return;throw error;}
    const cached=this.entries.get(path);
    if(before.isFile()&&cached&&sameIdentity(before,cached.identity)){
      this.entries.delete(path);this.entries.set(path,cached);this.hits++;return cached.value;
    }
    this.invalidate(path);
    let value:string;
    try{this.sourceReads++;value=await this.readFile(path);}catch(error:any){if(error.code==='ENOENT')return;throw error;}
    if(retain&&before.isFile()&&value.length<=this.maxCharacters&&this.maxEntries>0){
      // A concurrent replacement or write cannot authenticate the bytes just
      // read for later reuse. Preserve ordinary read semantics, but do not cache.
      try{
        const after=await fs.lstat(path,{bigint:true});
        if(after.isFile()&&sameIdentity(before,after)){
          this.invalidate(path);this.entries.set(path,{identity:after,value});this.characters+=value.length;
          while(this.entries.size>this.maxEntries||this.characters>this.maxCharacters)this.invalidate(this.entries.keys().next().value!);
        }
      }catch{/* A successful read still returns its bytes; a later read checks again. */}
    }
    return value;
  }
}
