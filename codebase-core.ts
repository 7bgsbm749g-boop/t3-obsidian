import type {FolderLink} from './folder-link';
import {folderLinkForPath} from './folder-link';
export const CODEBASE_PREFIX='__t3_codebase__/';
export interface CodebaseScope {environmentId:string;projectId:string;title:string;root:string;threadId?:string}
export interface CodebaseEntry {path:string;kind:'file'|'directory'}
export interface CodebaseIO {
  dispose?():void|Promise<void>;
  workspaces?(scope:CodebaseScope):Promise<CodebaseScope[]>;
  list(scope:CodebaseScope,directory:string):Promise<{entries:CodebaseEntry[];truncated:boolean}>;
  search(scope:CodebaseScope,name:string):Promise<CodebaseEntry[]>;
  read(scope:CodebaseScope,path:string):Promise<string>;
  write(scope:CodebaseScope,path:string,text:string):Promise<void>;
  resource(scope:CodebaseScope,path:string):Promise<{url:string;expiresAt:number}>;
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
  for(const link of links)if(!link.self&&link.environmentId){const scope={environmentId:link.environmentId,projectId:link.projectId,title:link.projectTitle,root:link.workspaceRoot};result.set(scopeKey(scope),scope);}
  return [...result.values()];
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
  base?:string;
  draft?:string;
  uncertain=false;
  constructor(readonly scope:CodebaseScope,readonly path:string,private io:CodebaseIO,private retain:(draft:string|undefined)=>void){}
  read(force=false):Promise<string>{
    if(!force&&this.base!==undefined&&Date.now()-this.readAt<15000)return Promise.resolve(this.base);
    if(this.reading)return this.reading;
    const reading=this.io.read(this.scope,this.path).then(text=>{if(this.draft!==undefined&&text!==this.base)throw Error('The project file changed. Your edit is kept on this device.');this.base=text;this.readAt=Date.now();return text;});
    this.reading=reading;void reading.finally(()=>{if(this.reading===reading)this.reading=undefined;}).catch(()=>{});return reading;
  }
  save(text:string):Promise<void>{
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
