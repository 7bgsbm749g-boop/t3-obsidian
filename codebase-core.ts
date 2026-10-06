import type {FolderLink} from './folder-link';
import {folderLinkForPath} from './folder-link';
export const CODEBASE_PREFIX='__t3_codebase__/';
export interface CodebaseScope {environmentId:string;projectId:string;title:string;root:string;threadId?:string}
export interface CodebaseEntry {path:string;kind:'file'|'directory'}
export interface CodebaseProjectChange {title?:string;deleted?:boolean}
export function changeCodebaseProjectLinks(links:FolderLink[],scope:CodebaseScope,change:CodebaseProjectChange,environment:(link:FolderLink)=>string|undefined):FolderLink[]{
  const matches=(link:FolderLink)=>link.projectId===scope.projectId&&environment(link)===scope.environmentId;
  return change.deleted?links.filter(link=>!matches(link)):links.map(link=>matches(link)?{...link,projectTitle:change.title!}:link);
}
export interface CodebaseIO {
  timings?:Array<{operation:string;milliseconds:number}>;
  dispose?():void|Promise<void>;
  workspaces?(scope:CodebaseScope):Promise<CodebaseScope[]>;
  list(scope:CodebaseScope,directory:string):Promise<{entries:CodebaseEntry[];truncated:boolean}>;
  search(scope:CodebaseScope,name:string):Promise<CodebaseEntry[]>;
  read(scope:CodebaseScope,path:string):Promise<string>;
  write(scope:CodebaseScope,path:string,text:string):Promise<void>;
  resource(scope:CodebaseScope,path:string):Promise<{url:string;expiresAt:number}>;
  renameProject?(scope:CodebaseScope,title:string):Promise<void>;
  deleteProject?(scope:CodebaseScope):Promise<void>;
}
export function relativeCodebasePath(path:string):string {
  if(!path||path.startsWith('/')||path.includes('\\')||/[\x00-\x1f]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..')||/^[a-z]:/i.test(path))throw Error('Invalid project file path.');
  return path;
}
export function scopeKey(scope:CodebaseScope){return [scope.environmentId,scope.projectId,scope.threadId??'main'].map(encodeURIComponent).join('/');}
// A changed workspace is a new native file identity. Late autosaves from its
// old native editor must never resolve to a file in the new workspace.
export function virtualPath(scope:CodebaseScope,path:string){return CODEBASE_PREFIX+scopeKey(scope)+'/'+encodeURIComponent(scope.root)+'/'+relativeCodebasePath(path);}
export function linkedCodebases(links:FolderLink[]):CodebaseScope[]{
  const result=new Map<string,CodebaseScope>();
  const self=new Set(links.filter(link=>link.self&&link.environmentId).map(link=>JSON.stringify([link.environmentId,link.projectId])));
  for(const link of links)if(!link.self&&link.environmentId&&!self.has(JSON.stringify([link.environmentId,link.projectId]))){const scope={environmentId:link.environmentId,projectId:link.projectId,title:link.projectTitle,root:link.workspaceRoot};result.set(scopeKey(scope),scope);}
  return [...result.values()];
}
/** Duplicate titles need a visible workspace hint; note links stay bare. */
export function codebaseRootLabels(scopes:CodebaseScope[]):Map<string,string>{
  const result=new Map<string,string>();
  for(const scope of scopes){
    const peers=scopes.filter(other=>other.title===scope.title);
    let label=scope.title;
    if(peers.length>1){
      const partsOf=(root:string)=>root.replace(/\\/g,'/').split('/').filter(Boolean);
      const sameName=peers.every(other=>partsOf(other.root).at(-1)===partsOf(scope.root).at(-1));
      const parents=(root:string)=>sameName?partsOf(root).slice(0,-1):partsOf(root);
      const parts=parents(scope.root);let hint=scope.root;
      for(let count=1;count<=parts.length;count++){
        hint=parts.slice(-count).join('/');
        if(peers.every(other=>other===scope||other.root===scope.root||parents(other.root).slice(-count).join('/')!==hint))break;
      }
      label+=` (${hint})`;
    }
    result.set(scopeKey(scope),label);
  }
  return result;
}
export function contextualCandidates<T extends {scope:CodebaseScope;path:string}>(files:T[],name:string,note:string,links:FolderLink[]):T[]{
  const clean=name.split('#')[0],matches=files.filter(f=>{const base=f.path.split('/').at(-1)!;return base===clean||base.endsWith('.md')&&base.slice(0,-3)===clean;});
  const link=folderLinkForPath(links,note),scoped=link&&!link.self?matches.filter(f=>f.scope.projectId===link.projectId&&f.scope.environmentId===link.environmentId):[];
  return scoped.length?scoped:matches;
}
export class CodebaseDocument {
  private queue:Promise<void>=Promise.resolve();
  private reading?:Promise<string>;
  private readAt=0;
  // Every confirmed base assignment retires reads started against older state.
  private baseVersion=0;
  private loaded?:string;
  get base(){return this.loaded;}
  set base(text:string|undefined){this.loaded=text;this.baseVersion++;}
  draft?:string;
  uncertain=false;
  constructor(readonly scope:CodebaseScope,readonly path:string,private io:CodebaseIO,private retain:(draft:string|undefined)=>void,private canAdoptRead:()=>boolean=()=>true){}
  read(force=false):Promise<string>{
    if(!force&&this.base!==undefined&&Date.now()-this.readAt<15000)return Promise.resolve(this.base);
    if(this.reading)return this.reading;
    const version=this.baseVersion;
    const reading=this.io.read(this.scope,this.path).then(text=>{if(this.base!==undefined&&(this.baseVersion!==version||!this.canAdoptRead()))return this.base;if(this.draft!==undefined&&text!==this.base)throw Error('The project file changed. Your edit is kept on this device.');this.base=text;this.readAt=Date.now();return text;});
    this.reading=reading;void reading.finally(()=>{if(this.reading===reading)this.reading=undefined;}).catch(()=>{});return reading;
  }
  save(text:string):Promise<void>{
    // Native navigation can force a save of an untouched loaded buffer. It
    // must not check/write a changing remote file or replace a recovery draft.
    if(text===this.base)return Promise.resolve();
    this.draft=text;this.retain(text);
    const task=this.queue.then(async()=>{
      if(this.uncertain)throw Error('The last save is not confirmed. Your edit is kept. Reopen the file to compare it before another save.');
      if(this.base===undefined)throw Error('Read the project file before saving it.');
      const current=await this.io.read(this.scope,this.path);
      if(current!==this.base)throw Error('The project file changed. Your edit is kept on this device.');
      if(text!==current){
        this.uncertain=true;
        await this.io.write(this.scope,this.path,text);
        if(await this.io.read(this.scope,this.path)!==text)throw Error('The saved project file could not be confirmed. Your edit is kept.');
        this.uncertain=false;
      }
      this.base=text;
      this.readAt=Date.now();
      if(this.draft===text){this.draft=undefined;this.retain(undefined);}
    });
    this.queue=task.catch(()=>{});return task;
  }
}
