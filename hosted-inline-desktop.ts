// Desktop-only host storage. Hidden configuration files are reached directly
// through T3's authenticated file API, not transported by Obsidian Sync.
import {promises as fs} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import lockfile from 'proper-lockfile';
import type {App} from 'obsidian';
import {HostedInlineWriter,type InlineFiles} from './hosted-inline';
import type {ThreadAccess} from './thread-stream';

export function localInlineFiles(root:string,directory:string):InlineFiles&{requests():Promise<string[]>}{
  const base=resolve(root,directory);
  const full=(path:string)=>{
    if(!path.startsWith(directory+'/')||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='.'))throw Error('Invalid hosted response storage path.');
    const result=resolve(root,path);if(!result.startsWith(base+require('node:path').sep))throw Error('Invalid hosted response storage path.');return result;
  };
  return {
    async read(path){try{return await fs.readFile(full(path),'utf8');}catch(error:any){if(error.code==='ENOENT')return undefined;throw error;}},
    async write(path,contents){const target=full(path);await fs.mkdir(dirname(target),{recursive:true});const temporary=target+'.'+require('node:crypto').randomUUID()+'.tmp';try{await fs.writeFile(temporary,contents,{mode:0o600});await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}},
    async requests(){try{return (await fs.readdir(join(base,'requests'))).filter(p=>p.endsWith('.json')).map(p=>`${directory}/requests/${p}`);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}},
  };
}

export class DesktopInlineHost {
  private writer:HostedInlineWriter;
  private work?:Promise<void>;
  private stopped=false;
  private accesses=new Map<string,{access:ThreadAccess;expires:number}>();
  private constructor(private release:()=>Promise<void>,app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},files:ReturnType<typeof localInlineFiles>,access:(environmentId:string)=>Promise<ThreadAccess>){
    this.writer=new HostedInlineWriter(identity,{
      ...files,
      access:async environmentId=>{
        const cached=this.accesses.get(environmentId);
        if(cached&&cached.expires>Date.now())return cached.access;
        this.accesses.delete(environmentId);await cached?.access.close?.();
        const fresh=await access(environmentId);this.accesses.set(environmentId,{access:fresh,expires:Date.now()+180_000});return fresh;
      },
      updateNote:async(path,change)=>{
        const file=app.vault.getFileByPath(path);if(!file)return undefined;
        const current=await app.vault.read(file);
        const saved=(value:string)=>app.workspace.getLeavesOfType('markdown').every(leaf=>{const view=leaf.view as any;return view.file?.path!==path||!view.editor||view.editor.getValue()===value;});
        if(this.stopped||!saved(current))return undefined;
        let applied=false;
        const result=await app.vault.process(file,value=>{if(this.stopped||!saved(value))return value;applied=true;return change(value);});
        return applied?result:undefined;
      },
    });
  }
  static async open(app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},access:(environmentId:string)=>Promise<ThreadAccess>){
    const base=join(identity.workspaceRoot,identity.directory);await fs.mkdir(base,{recursive:true});
    let host:DesktopInlineHost|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:()=>{host?.dispose();}});
    host=new DesktopInlineHost(release,app,identity,localInlineFiles(identity.workspaceRoot,identity.directory),access);return host;
  }
  tick(){if(this.stopped)return Promise.resolve();if(this.work)return this.work;const work=this.writer.tick();this.work=work;void work.finally(()=>{if(this.work===work)this.work=undefined;}).catch(()=>{});return work;}
  renamed(before:string,after:string){this.writer.renamed(before,after);}
  dispose(){if(this.stopped)return;this.stopped=true;this.writer.stop();void (async()=>{try{await this.work;}catch{}finally{for(const {access} of this.accesses.values())await access.close?.();this.accesses.clear();await this.release();}})().catch(()=>{});}
}
