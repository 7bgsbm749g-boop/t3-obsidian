interface LogFiles {
  exists(path:string):Promise<boolean>;
  remove(path:string):Promise<void>;
  read(path:string):Promise<string>;
  list?(path:string):Promise<{files:string[];folders:string[]}>;
  rmdir?(path:string,recursive:boolean):Promise<void>;
}

/** One-time startup cleanup, with no journal, timers, watchers or publication. */
export async function clearVaultDiagnostics(files:LogFiles,configDir='.obsidian'):Promise<void> {
  const shared=`${configDir}/t3-code-log.json`;
  if(await files.exists(shared))await files.remove(shared);
  const retired='T3 Code Logs';
  if(!files.list||!await files.exists(retired))return;
  const visit=async(path:string)=>{
    const entries=await files.list!(path);
    for(const file of entries.files){
      if(file.endsWith('.md')&&(await files.read(file)).startsWith('# T3 Code plugin event log\n'))await files.remove(file);
    }
    for(const folder of entries.folders)await visit(folder);
    const remaining=await files.list!(path);
    if(!remaining.files.length&&!remaining.folders.length&&files.rmdir)await files.rmdir(path,false);
  };
  await visit(retired);
}
