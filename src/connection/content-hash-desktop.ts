import {Platform} from 'obsidian';
let createHash:typeof import('node:crypto').createHash;
let desktopReady:Promise<void>|undefined;
function loadDesktop():Promise<void>{
  if(Platform.isDesktop){
    return desktopReady??=(async()=>{
    ({createHash}=await import('node:crypto'));
    })();
  }
  throw Error('This feature requires Obsidian on desktop.');
}

import {installContentHasher} from '../responses/completion';

/** OpenSSL consumes the string directly, avoiding the portable SHA loop and
 * its full-size temporary Uint8Array. Hash bytes and formatting stay identical. */
export async function installDesktopContentHash(){
  await loadDesktop();
  return installContentHasher(text=>createHash('sha256').update(text,'utf8').digest('hex'));
}
