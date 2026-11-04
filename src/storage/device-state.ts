// IndexedDB is local to this Obsidian installation and can hold image requests
// larger than localStorage's typical 5 MiB limit, plus non-extractable DPoP keys.
// Neither requests nor keys are placed in the synced vault.
import {openStateDatabase} from './local-state';

export async function deviceState(key:string, value?:unknown):Promise<any> {
  const db=await openStateDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const transaction=db.transaction('devices',value===undefined?'readonly':'readwrite');
      const store=transaction.objectStore('devices');
      const request=value===undefined?store.get(key):store.put(value,key);
      transaction.oncomplete=()=>resolve(request.result);
      transaction.onabort=()=>reject(new Error('Cannot save local requests. Free device storage and retry.'));
      transaction.onerror=()=>reject(new Error('Cannot access local request storage.'));
    });
  }finally{db.close();}
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
