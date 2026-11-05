import {Buffer} from 'buffer/';
import {isRecord,records} from '../shared/values';
import {contentHash} from '../responses/completion';
import {COMMAND_DIRECTORY,COMMAND_MAX_BYTES,type CommandFiles} from './connect-command-host';

type Rpc={call(tag:string,payload:unknown):Promise<unknown>};
const CHUNK_BYTES=24_000;
function checked(path:string){if(!path.startsWith(COMMAND_DIRECTORY+'/')||path.length>1000||!/^[a-zA-Z0-9_./-]+$/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid Obsidian transport path.');return path;}
/** T3 bounds text reads. Large snapshots use immutable, checksum-addressed
 * chunks so a truncated read can never become a valid edit proposal. */
export function connectCommandFiles(rpc:Rpc,workspaceRoot:string):CommandFiles {
  const rawRead=async(path:string)=>{
    try{
      const result=await rpc.call('projects.readFile',{cwd:workspaceRoot,relativePath:checked(path)});
      if(!isRecord(result)||result.truncated||typeof result.contents!=='string')throw Error('T3 could not return the complete Obsidian request.');
      return result.contents;
    }catch(error){if(isRecord(error)&&error.kind==='ProjectReadFileError')return;throw error;}
  };
  const rawWrite=async(path:string,contents:string)=>{await rpc.call('projects.writeFile',{cwd:workspaceRoot,relativePath:checked(path),contents});};
  return {
    async read(path){
      const raw=await rawRead(path);if(raw===undefined)return;
      let value:unknown;try{value=JSON.parse(raw) as unknown;}catch{return raw;}
      if(!isRecord(value)||value.schema!=='t3-obsidian-blob-v1')return raw;
      if(typeof value.hash!=='string'||!/^[a-f0-9]{64}$/.test(value.hash)||typeof value.bytes!=='number'||value.bytes<0||value.bytes>COMMAND_MAX_BYTES||!Number.isInteger(value.parts)||Number(value.parts)<1||Number(value.parts)>Math.ceil(COMMAND_MAX_BYTES/CHUNK_BYTES))throw Error('Invalid Obsidian transport manifest.');
      const chunks:Uint8Array[]=[];let size=0;
      for(let index=0;index<Number(value.parts);index++){
        const part=await rawRead(path+'.parts/'+value.hash+'/'+index+'.txt');if(part===undefined||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(part))throw Error('An Obsidian request chunk is missing or invalid.');
        const bytes=Buffer.from(part,'base64');size+=bytes.length;if(size>COMMAND_MAX_BYTES)throw Error('The Obsidian request is too large.');chunks.push(bytes);
      }
      let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw Error('The Obsidian request encoding changed during transfer.');}
      if(size!==value.bytes||contentHash(text)!==value.hash)throw Error('The Obsidian request changed during transfer.');return text;
    },
    async write(path,text){
      const bytes=new TextEncoder().encode(text);if(bytes.length>COMMAND_MAX_BYTES)throw Error('The Obsidian request is too large.');
      if(bytes.length<=CHUNK_BYTES){await rawWrite(path,text);return;}
      const hash=contentHash(text),parts=Math.ceil(bytes.length/CHUNK_BYTES);
      for(let index=0;index<parts;index++)await rawWrite(path+'.parts/'+hash+'/'+index+'.txt',Buffer.from(bytes.slice(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES)).toString('base64'));
      await rawWrite(path,JSON.stringify({schema:'t3-obsidian-blob-v1',hash,bytes:bytes.length,parts}));
    },
    async list(path){
      try{
        const result=await rpc.call('projects.listEntries',{cwd:workspaceRoot,directoryPath:checked(path)});
        if(!isRecord(result)||result.truncated||!Array.isArray(result.entries))throw Error('T3 returned an incomplete Obsidian request list.');
        return records(result.entries).filter(entry=>entry.kind==='file'&&typeof entry.path==='string'&&entry.path.startsWith(path+'/')&&!entry.path.slice(path.length+1).includes('/')).map(entry=>checked(String(entry.path)));
      }catch(error){if(isRecord(error)&&['ProjectListEntriesError','ProjectEntriesError'].includes(String(error.kind)))return [];throw error;}
    },
  };
}
