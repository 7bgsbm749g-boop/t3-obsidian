// IndexedDB is local to this Obsidian installation and can hold image requests
// larger than localStorage's typical 5 MiB limit, plus non-extractable DPoP keys.
// Neither requests nor keys are placed in the synced vault.
export async function deviceState(key:string, value?:unknown):Promise<any> {
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('send-to-t3-code',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('devices');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Cannot open local request storage.'));
    request.onblocked=()=>reject(new Error('Local request storage is busy. Reload Obsidian.'));
  });
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
