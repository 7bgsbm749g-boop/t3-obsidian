import {readThreadList} from './wire-readers';
import {projectThreads,type ThreadChoice} from '../conversations/thread-target';

/** Picker metadata only. Never retains message bodies or authorizes a send or
 * checked save. Credentials and environment identity select separate entries. */
export class ThreadCatalogCache {
 private entries=new Map<string,{until:number;refreshAt:number;projects:Map<string,ThreadChoice[]>}>();
 private identities=new Map<string,object>();
 private refreshing=new Map<string,Promise<void>>();
 private listeners=new Map<string,Set<()=>void>>();
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
   projects.set(projectId,projectThreads({threads},projectId).map(({id,projectId,title,updatedAt,status,branch})=>({id,projectId,title,updatedAt,status,...(typeof branch==='string'&&branch?{branch}: {})})));
  }
  this.entries.delete(identity);this.entries.set(identity,{until:expiresAt-5000,refreshAt:this.now()+300_000,projects});
  while(this.entries.size>16)this.entries.delete(this.entries.keys().next().value!);
  this.notify(identity);
 }
 read(identity:string,projectId:string):ThreadChoice[]|undefined{
  const entry=this.entries.get(identity);if(!entry)return;
  if(entry.until<=this.now()){this.entries.delete(identity);return;}
  return (entry.projects.get(projectId)??[]).map(thread=>({...thread}));
 }
 needsRefresh(identity:string){const entry=this.entries.get(identity);return !entry||entry.refreshAt<=this.now()||entry.until<=this.now();}
 observe(identity:string,read:Promise<unknown>){
  if(this.refreshing.has(identity))return;
  const work=read.then(()=>{},()=>{}).finally(()=>{if(this.refreshing.get(identity)===work)this.refreshing.delete(identity);});
  this.refreshing.set(identity,work);
 }
 prepare(identity:string,read:()=>Promise<unknown>):Promise<void>{
  if(!this.needsRefresh(identity))return Promise.resolve();
  const pending=this.refreshing.get(identity);if(pending)return pending;
  const work=Promise.resolve().then(read).then(()=>{}).finally(()=>{if(this.refreshing.get(identity)===work)this.refreshing.delete(identity);});
  this.refreshing.set(identity,work);return work;
 }
 watch(identity:string,changed:()=>void){
  const listeners=this.listeners.get(identity)??new Set<()=>void>();listeners.add(changed);this.listeners.set(identity,listeners);
  return ()=>{listeners.delete(changed);if(!listeners.size)this.listeners.delete(identity);};
 }
 private notify(identity:string){for(const changed of this.listeners.get(identity)??[])try{changed();}catch{/* A closed picker cannot fail a catalog read. */}}
 delete(identity:string){this.entries.delete(identity);this.identities.delete(identity);this.notify(identity);}
}
