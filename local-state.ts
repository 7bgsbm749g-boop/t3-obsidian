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
