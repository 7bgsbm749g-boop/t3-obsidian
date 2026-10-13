import {promises as fs,statSync,realpathSync,readdirSync} from 'node:fs';
import {join,resolve,dirname,sep,basename,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {App} from 'obsidian';
import {safeNotePath} from './hosted-inline';
import {ResponseNoteLocator} from './response-location';
import type {CoordinatedHostRuntime} from './coordinated-host-desktop';

/** Filesystem adapter for the background host. It has no editor or renderer. */
export function responseHostFilesystem(root:string,active:()=>boolean){
  root=realpathSync(root);
  const files=new Map<string,any>(),queues=new Map<string,Promise<unknown>>();
  const full=(path:string)=>{if(!safeNotePath(path))throw Error('Invalid response note path.');const target=resolve(root,path);if(!target.startsWith(root+sep)||!realpathSync(target).startsWith(root+sep))throw Error('A response note leaves its vault.');return target;};
  const getFileByPath=(path:string)=>{
    try{const target=full(path),stat=statSync(target);if(!stat.isFile())return;let file=files.get(path);if(!file||file.identity!==`${stat.dev}:${stat.ino}`){file={path,name:basename(path),basename:basename(path,extname(path)),extension:extname(path).slice(1),identity:`${stat.dev}:${stat.ino}`};files.set(path,file);}file.stat={size:stat.size,mtime:stat.mtimeMs,ctime:stat.birthtimeMs};return file;}catch(error:any){if(error.code==='ENOENT')return;throw error;}
  };
  const getMarkdownFiles=()=>{
    const found:any[]=[];
    const visit=(directory:string)=>{for(const entry of readdirSync(join(root,directory),{withFileTypes:true})){if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;const path=directory?directory+'/'+entry.name:entry.name;if(entry.isDirectory())visit(path);else if(entry.isFile()&&path.endsWith('.md')){const file=getFileByPath(path);if(file)found.push(file);}}};visit('');return found;
  };
  const read=async(file:any)=>fs.readFile(full(file.path),'utf8');
  const process=async(file:any,change:(text:string)=>string)=>{
    const path=file.path,work=(queues.get(path)??Promise.resolve()).catch(()=>{}).then(async()=>{
      if(!active()||getFileByPath(path)!==file)throw Error('The response note changed before its save.');
      const target=full(path),before=await fs.readFile(target,'utf8'),observed=await fs.stat(target),after=change(before);
      if(after===before)return before;
      const temporary=target+'.t3-'+randomUUID()+'.tmp';
      try{
        const output=await fs.open(temporary,'wx',observed.mode&0o777);
        try{await output.writeFile(after);await output.sync();}finally{await output.close();}
        const current=await fs.stat(target);
        if(!active()||getFileByPath(path)!==file||current.ino!==observed.ino||current.mtimeMs!==observed.mtimeMs||current.size!==observed.size||await fs.readFile(target,'utf8')!==before)throw Error('The response note changed during its save.');
        await fs.rename(temporary,target);
        const saved=await fs.stat(target);file.identity=`${saved.dev}:${saved.ino}`;
        const directory=await fs.open(dirname(target),'r');try{await directory.sync();}finally{await directory.close();}
        if(await fs.readFile(target,'utf8')!==after)throw Error('The response save did not verify.');
        return after;
      }finally{await fs.rm(temporary,{force:true});}
    });queues.set(path,work);void work.finally(()=>{if(queues.get(path)===work)queues.delete(path);}).catch(()=>{});return work;
  };
  const app={vault:{getFileByPath,getMarkdownFiles,read,process},workspace:{getLeavesOfType:()=>[]}} as unknown as App;
  const readNote=async(path:string)=>{const file=getFileByPath(path);return file?read(file):undefined;};
  const locator=new ResponseNoteLocator(()=>getMarkdownFiles().map(file=>file.path),readNote);
  const runtime:CoordinatedHostRuntime={projection:{receive:async()=>{},savedViews:()=>[],prepare:()=>{},committed:()=>{},cancel:()=>{}},notes:{readNote,locateNote:(id,path)=>locator.locate(id,path),noteChanged:path=>locator.changed(path),noteRelocated:(id,before,after,hash)=>locator.relocated(id,before,after,hash),updateNote:async(path,change,allowed)=>{const file=getFileByPath(path);if(!file||!allowed())return;return process(file,current=>{if(!allowed())throw Error('Response ownership changed before the save.');return change(current);});}}};
  return {app,runtime,getFileByPath,readNote,getMarkdownFiles};
}
