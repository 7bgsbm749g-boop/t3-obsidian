import {promises as fs,constants} from 'node:fs';
import {resolve} from 'node:path';

/** Only installed on access to this desktop's verified local T3 environment. */
export async function readDesktopReplyFile(source:string,workspace:string,limit=25*1024*1024):Promise<Uint8Array> {
  const path=await fs.realpath(resolve(workspace,source));
  const handle=await fs.open(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();
    if(!stat.isFile())throw Error('The linked attachment is not a regular file.');
    if(stat.size>limit)throw Error('The linked file exceeds 25 MiB.');
    const buffer=new Uint8Array(Math.min(stat.size+1,limit+1));let size=0;
    while(size<buffer.length){const read=await handle.read(buffer,size,buffer.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}
    if(size!==stat.size)throw Error('The linked file changed while it was read.');
    return buffer.slice(0,size);
  }finally{await handle.close();}
}
