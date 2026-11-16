/** Keep the installed IndexedDB identity and version; historical stores remain
 * untouched, but only device state is opened by the plugin. */
export async function openStateDatabase():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('send-to-t3-code',3);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('devices'))request.result.createObjectStore('devices');};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Cannot open local plugin storage.'));
    request.onblocked=()=>reject(new Error('Local plugin storage is busy. Reload Obsidian.'));
  });
}

// Device-state operations share an opening attempt and a live connection. Other
// stores can still own/close independent connections from openStateDatabase().
let shared:Promise<IDBDatabase>|undefined;
export function sharedStateDatabase():Promise<IDBDatabase>{
  if(shared)return shared;
  const opening=openStateDatabase().then(db=>{
    const retire=()=>{if(shared===opening)shared=undefined;db.close();};
    db.onversionchange=retire;
    db.onclose=()=>{if(shared===opening)shared=undefined;};
    return db;
  });
  shared=opening;
  void opening.catch(()=>{if(shared===opening)shared=undefined;});
  return opening;
}
/** Closing allows already-created transactions to finish; next use reopens. */
export function closeSharedStateDatabase():void{
  const opening=shared;shared=undefined;
  void opening?.then(db=>db.close(),()=>{});
}
