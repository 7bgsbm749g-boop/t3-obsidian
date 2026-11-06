// Maintainer-only lab paths. Never import this module into the plugin runtime.
import {execFileSync} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function projectEvidenceRoot(){
  return execFileSync('python3',[fileURLToPath(new URL('./maintainer_config.py',import.meta.url)),'--evidence-root'],{encoding:'utf8',timeout:10000,maxBuffer:65536}).trim();
}

async function canonical(path){
  try{return await realpath(path);}
  catch(error){if(error.code!=='ENOENT')throw error;return resolve(await canonical(dirname(path)),basename(path));}
}

export async function requireEvidenceDirectory(destination,message='Use a task directory inside the configured external project evidence root.'){
  const root=await canonical(projectEvidenceRoot()),directory=await canonical(resolve(destination));
  const part=relative(root,directory);
  if(!part||isAbsolute(part)||part==='..'||part.startsWith('../'))throw Error(message);
  return directory;
}
