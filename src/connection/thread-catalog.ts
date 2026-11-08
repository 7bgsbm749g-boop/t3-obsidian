import {readThreadList} from './wire-readers';
import {projectThreads,type ThreadChoice} from '../conversations/thread-target';

/** Picker metadata only. Never retains message bodies or authorizes a send or
 * checked save. Credentials and environment identity select separate entries. */
export class ThreadCatalogCache {
 private entries=new Map<string,{until:number;projects:Map<string,ThreadChoice[]>}>();
 private identities=new Map<string,object>();
 constructor(private now=()=>Date.now()){}
 scope(identity:string){
  let scope=this.identities.get(identity);if(!scope){scope={};this.identities.set(identity,scope);}
  while(this.identities.size>16)this.identities.delete(this.identities.keys().next().value!);
  return scope;
 }
 remember(identity:string,shell:unknown,expiresAt:number){
  const threads=readThreadList(shell),projects=new Map<string,ThreadChoice[]>();
  for(const projectId of new Set(threads.map(thread=>thread.projectId))){
   if(typeof projectId!=='string')continue;
   projects.set(projectId,projectThreads({threads},projectId).map(({id,projectId,title,updatedAt,status})=>({id,projectId,title,updatedAt,status})));
  }
  this.entries.delete(identity);this.entries.set(identity,{until:Math.min(this.now()+300_000,expiresAt-5000),projects});
  while(this.entries.size>16)this.entries.delete(this.entries.keys().next().value!);
 }
 read(identity:string,projectId:string):ThreadChoice[]|undefined{
  const entry=this.entries.get(identity);if(!entry)return;
  if(entry.until<=this.now()){this.entries.delete(identity);return;}
  return (entry.projects.get(projectId)??[]).map(thread=>({...thread}));
 }
 delete(identity:string){this.entries.delete(identity);this.identities.delete(identity);}
}
