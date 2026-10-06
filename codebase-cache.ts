import {relativeCodebasePath,scopeKey,type CodebaseScope,type CodebaseIO,type CodebaseEntry} from './codebase-core';
export interface FolderSnapshot {scope:CodebaseScope;directory:string;entries:CodebaseEntry[];at:number}
export interface BrowseState {version:1;folders:FolderSnapshot[];workspaces:Array<{scope:CodebaseScope;entries:CodebaseScope[];at:number}>}
export function folderKey(scope:CodebaseScope,directory:string){return JSON.stringify([scopeKey(scope),scope.root,directory]);}
/** Device-local names only. Stale snapshots stay visible during refresh/failure. */
export class CodebaseBrowseCache {
  private folders=new Map<string,FolderSnapshot>();
  private emptyWorkspaces:CodebaseScope[]=[];
  private worktrees=new Map<string,{scope:CodebaseScope;entries:CodebaseScope[];at:number}>();
  private pending=new Map<string,Promise<void>>();
  private failures=new Map<string,number>();
  readonly errors=new Map<string,string>();
  private running=0;private waiting:Array<()=>void>=[];private stopped=false;
  constructor(private io:CodebaseIO,private changed:(key?:string)=>void,private persist:(state:BrowseState)=>void,private now=Date.now){}
  adopt(state:BrowseState|undefined){if(state?.version!==1)return;for(const item of state.folders??[])try{if(item.directory)relativeCodebasePath(item.directory);if(item.entries.length>10000)continue;for(const entry of item.entries){relativeCodebasePath(entry.path);if(entry.kind!=='file'&&entry.kind!=='directory')throw Error('Invalid kind');const parent=entry.path.split('/').slice(0,-1).join('/');if(parent!==item.directory)throw Error('Invalid folder');}this.folders.set(folderKey(item.scope,item.directory),item);}catch{}for(const item of state.workspaces??[])if(Array.isArray(item.entries))this.worktrees.set(folderKey(item.scope,''),item);this.trim();}
  get(scope:CodebaseScope,directory:string){return this.folders.get(folderKey(scope,directory));}
  workspaces(scope:CodebaseScope){return this.worktrees.get(folderKey(scope,''))?.entries??this.emptyWorkspaces;}
  loading(scope:CodebaseScope,directory:string){return this.pending.has(folderKey(scope,directory));}
  async load(scope:CodebaseScope,directory:string,force=false){const key=folderKey(scope,directory),snapshot=this.get(scope,directory);return this.request(key,snapshot?.at,force,async()=>{const result=await this.io.list(scope,directory);if(result.truncated)throw Error('T3 returned an incomplete folder.');for(const entry of result.entries){relativeCodebasePath(entry.path);if(entry.path.split('/').slice(0,-1).join('/')!==directory)throw Error('T3 returned a file outside this folder.');}this.folders.delete(key);this.folders.set(key,{scope,directory,entries:result.entries,at:this.now()});this.trim();});}
  async loadWorkspaces(scope:CodebaseScope,force=false){if(!this.io.workspaces)return;const key=folderKey(scope,''),snapshot=this.worktrees.get(key);return this.request('workspaces:'+key,snapshot?.at,force,async()=>{const entries=await this.io.workspaces!(scope);this.worktrees.set(key,{scope,entries,at:this.now()});});}
  private request(key:string,at:number|undefined,force:boolean,fetch:()=>Promise<void>){
    const pending=this.pending.get(key);if(pending)return pending;
    if(this.stopped||!force&&(at!==undefined&&this.now()-at<15000||this.now()-(this.failures.get(key)??-Infinity)<5000))return Promise.resolve();
    const task=(async()=>{await this.slot();try{if(this.stopped)return;await fetch();if(this.stopped)return;this.errors.delete(key);this.failures.delete(key);this.persist(this.state());}catch(error){if(!this.stopped){this.errors.set(key,error instanceof Error?error.message:String(error));this.failures.set(key,this.now());}}finally{const next=this.waiting.shift();if(next)next();else this.running--;}})();
    this.pending.set(key,task);this.changed(key);void task.finally(()=>{this.pending.delete(key);if(!this.stopped)this.changed(key);});return task;
  }
  private async slot(){if(this.running<4){this.running++;return;}await new Promise<void>(resolve=>this.waiting.push(resolve));}
  private trim(){let total=[...this.folders.values()].reduce((sum,item)=>sum+item.entries.length,0);for(const [key,item] of this.folders){if(total<=20000&&this.folders.size<=128)break;this.folders.delete(key);total-=item.entries.length;}}

  private state():BrowseState{return {version:1,folders:[...this.folders.values()],workspaces:[...this.worktrees.values()].slice(-128)};}
  flush(){this.persist(this.state());}
  dispose(){this.stopped=true;}
}
