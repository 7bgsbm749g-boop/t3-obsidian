// IndexedDB is local to this Obsidian installation and can hold image requests
// larger than localStorage's typical 5 MiB limit, plus non-extractable DPoP keys.
// Neither requests nor keys are placed in the synced vault.
import {openStateDatabase} from './local-state';

export function deviceState<T=unknown>(key:string):Promise<T|undefined>;
export function deviceState(key:string,value:unknown):Promise<void>;
export async function deviceState(key:string, value?:unknown):Promise<unknown> {
  const db=await openStateDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const transaction=db.transaction('devices',value===undefined?'readonly':'readwrite');
      const store=transaction.objectStore('devices');
      const request=value===undefined?store.get(key):store.put(value,key);
      transaction.oncomplete=()=>resolve(value===undefined?request.result as unknown:undefined);
      transaction.onabort=()=>reject(new Error('Cannot save local requests. Free device storage and retry.'));
      transaction.onerror=()=>reject(new Error('Cannot access local request storage.'));
    });
  }finally{db.close();}
}

export async function deleteDeviceState(key:string):Promise<void>{
  const db=await openStateDatabase();
  try{await new Promise<void>((resolve,reject)=>{const transaction=db.transaction('devices','readwrite');transaction.objectStore('devices').delete(key);transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot retire an expired device record.'));});}finally{db.close();}
}

/** Keep bounded private records and their index in one IndexedDB transaction.
 * Pending edits/ambiguous commands are retained until explicitly resolved. */
export async function retainDeviceState(namespace:string,id:string,value:unknown,limits:{records:number;bytes:number;ttl:number},pending=false):Promise<void>{
  const bytes=new TextEncoder().encode(JSON.stringify(value)).length,now=Date.now(),db=await openStateDatabase();
  type Entry={id:string;at:number;bytes:number;pending:boolean};
  try{await new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction('devices','readwrite'),store=transaction.objectStore('devices'),request=store.get(namespace+':index');
    let failure:Error|undefined;
    request.onsuccess=()=>{
      const entries=(request.result??[]) as Entry[];
      const retained=entries.filter(entry=>entry.id!==id&&(entry.pending||now-entry.at<limits.ttl));
      retained.push({id,at:now,bytes,pending});
      if(retained.length>limits.records||retained.reduce((sum,entry)=>sum+entry.bytes,0)>limits.bytes){failure=Error('Private command storage is full. Resolve pending edits or let completed records expire.');transaction.abort();return;}
      for(const entry of entries)if(!retained.some(item=>item.id===entry.id))store.delete(namespace+':'+entry.id);
      store.put(value,namespace+':'+id);store.put(retained,namespace+':index');
    };
    transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(failure??Error('Cannot retain private command state.'));
  });}finally{db.close();}
}

/** Remove diagnostic buffers only; credentials, requests and other vaults survive. */
export async function clearDeviceDiagnostics(vaultId:string):Promise<void> {
  const db=await openStateDatabase();
  try{
    await new Promise<void>((resolve,reject)=>{
      const transaction=db.transaction('devices','readwrite');
      const request=transaction.objectStore('devices').openCursor();
      request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;
        if(typeof cursor.key==='string'&&cursor.key.startsWith(`diagnostics:${vaultId}:`))cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete=()=>resolve();
      transaction.onabort=transaction.onerror=()=>reject(new Error('Cannot clear local plugin diagnostics.'));
    });
  }finally{db.close();}
}
