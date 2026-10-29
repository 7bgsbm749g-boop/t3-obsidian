import {openStateDatabase} from './local-state';
import {contentHash} from './completion';
import {safeNotePath} from './response-model';

export interface NativeStoppedResponse {id:string;path:string;body:string;hidden:boolean}
export type NativeStoppedReference=Omit<NativeStoppedResponse,'body'>;
export interface NativeStoppedStore {
  list?():Promise<NativeStoppedReference[]>;
  readAll(ids?:readonly string[]):Promise<NativeStoppedResponse[]>;
  write(stop:NativeStoppedResponse):Promise<void>;
  relocate?(before:string,after:string):Promise<void>;
}
interface StopReference {id:string;path:string;hidden:boolean;hash:string;length:number}
interface StopIndex {version:1;entries:StopReference[]}
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function index(value:unknown):StopIndex {
  if(value===undefined)return {version:1,entries:[]};
  const candidate=value as StopIndex;
  if(candidate?.version!==1||!Array.isArray(candidate.entries)||candidate.entries.some(entry=>!entry||!uuid.test(entry.id)||!safeNotePath(entry.path)||typeof entry.hidden!=='boolean'||! /^[a-f0-9]{64}$/.test(entry.hash)||!Number.isSafeInteger(entry.length)||entry.length<0)||new Set(candidate.entries.map(entry=>entry.id)).size!==candidate.entries.length)throw Error('The frozen response index needs recovery.');
  return candidate;
}
/** Device-local immutable body blobs and routing index share one transaction.
 * The index cannot become visible before its complete body is durable. */
export function nativeStoppedStore(deviceId:string,vaultId:string):NativeStoppedStore {
  const prefix=`native-stop:${deviceId}:${vaultId}:`,indexKey=prefix+'index',bodyKey=(id:string,hash:string)=>`${prefix}body:${id}:${hash}`;
  return {
    async list(){
      const db=await openStateDatabase();try{return await new Promise<NativeStoppedReference[]>((resolve,reject)=>{
        const transaction=db.transaction('devices','readonly'),request=transaction.objectStore('devices').get(indexKey);let entries:NativeStoppedReference[]=[],failure:unknown;
        request.onsuccess=()=>{try{entries=index(request.result).entries.map(({id,path,hidden})=>({id,path,hidden}));}catch(error){failure=error;transaction.abort();}};
        transaction.oncomplete=()=>resolve(entries);transaction.onabort=transaction.onerror=()=>reject(failure??Error('Cannot read the frozen response index.'));
      });}finally{db.close();}
    },
    async readAll(ids){
      const selected=ids&&new Set(ids);
      const db=await openStateDatabase();try{return await new Promise<NativeStoppedResponse[]>((resolve,reject)=>{
        const transaction=db.transaction('devices','readonly'),store=transaction.objectStore('devices'),results:NativeStoppedResponse[]=[];let failure:unknown;
        const request=store.get(indexKey);request.onsuccess=()=>{try{for(const reference of index(request.result).entries){if(selected&&!selected.has(reference.id))continue;const read=store.get(bodyKey(reference.id,reference.hash));read.onsuccess=()=>{const body=read.result;if(typeof body!=='string'||body.length!==reference.length||contentHash(body)!==reference.hash){failure=Error('A frozen response body needs recovery.');transaction.abort();return;}results.push({id:reference.id,path:reference.path,body,hidden:reference.hidden});};}}catch(error){failure=error;transaction.abort();}};
        transaction.oncomplete=()=>resolve(results);transaction.onabort=transaction.onerror=()=>reject(failure??Error('Cannot restore frozen responses from this device.'));
      });}finally{db.close();}
    },
    async relocate(before,after){
      const db=await openStateDatabase();try{await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction('devices','readwrite'),store=transaction.objectStore('devices');let failure:unknown;
        const request=store.get(indexKey);request.onsuccess=()=>{try{const previous=index(request.result);store.put({version:1,entries:previous.entries.map(entry=>entry.path===before||entry.path.startsWith(before+'/')?{...entry,path:after+entry.path.slice(before.length)}:entry)},indexKey);}catch(error){failure=error;transaction.abort();}};
        transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(failure??Error('Cannot move the frozen response index.'));
      });}finally{db.close();}
    },
    async write(stop){
      if(!uuid.test(stop.id)||!safeNotePath(stop.path)||typeof stop.body!=='string'||typeof stop.hidden!=='boolean')throw Error('Invalid frozen response identity.');
      const reference:StopReference={id:stop.id,path:stop.path,hidden:stop.hidden,hash:contentHash(stop.body),length:stop.body.length},key=bodyKey(stop.id,reference.hash);
      const db=await openStateDatabase();try{await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction('devices','readwrite'),store=transaction.objectStore('devices');let failure:unknown;
        const request=store.get(indexKey);request.onsuccess=()=>{try{const previous=index(request.result),read=store.get(key);read.onsuccess=()=>{try{if(read.result!==undefined&&read.result!==stop.body)throw Error('The immutable frozen response changed.');if(read.result===undefined)store.put(stop.body,key);const next={version:1,entries:previous.entries.filter(entry=>entry.id!==stop.id).concat(reference)};store.put(next,indexKey);}catch(error){failure=error;transaction.abort();}};}catch(error){failure=error;transaction.abort();}};
        transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(failure??Error('Cannot save the frozen response. Free device storage and retry.'));
      });}finally{db.close();}
    },
  };
}
