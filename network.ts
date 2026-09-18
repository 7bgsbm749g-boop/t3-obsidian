import { requestUrl } from 'obsidian';
import { Buffer } from 'buffer';
import { withTimeout } from './bridge';
import { MAX_IMAGE_BYTES } from './images';
// Clerk's native API uses Authorization rather than browser cookies/Origin.
// Obsidian supplies this native HTTP transport on both desktop and mobile.
export const nativeAccountFetch:typeof fetch=async(input,options={})=>{
  const url=new URL(String(input));
  if(url.origin!=='https://clerk.t3.codes'||url.username||url.password||!url.pathname.startsWith('/v1/client'))throw new Error('Invalid T3 account endpoint.');
  const headers:Record<string,string>={};new Headers(options.headers).forEach((v,k)=>{headers[k]=v;});
  if(options.signal?.aborted)throw new Error('Cancelled');
  const r=await requestUrl({url:url.href,method:options.method??'GET',headers,...(typeof options.body==='string'?{body:options.body}:{}),throw:false});
  if(options.signal?.aborted)throw new Error('Cancelled');
  return new Response(r.text,{status:r.status,headers:r.headers});
};
export async function downloadImage(value:string):Promise<Buffer> {
  let url:URL;try{url=new URL(value);}catch{throw new Error('Invalid image URL.');}
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('Remote images require an HTTPS URL without credentials. Download this image into the vault first.');
  const response=await withTimeout(requestUrl({url:url.href,headers:{Accept:'image/png,image/jpeg,image/gif,image/webp'},throw:false}),30_000);
  if(response.status!==200)throw new Error(`Image download failed (HTTP ${response.status}).`);
  if(response.arrayBuffer.byteLength>MAX_IMAGE_BYTES)throw new Error('Image exceeds 10 MiB.');
  return Buffer.from(response.arrayBuffer);
}
