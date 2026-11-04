/** Optional adapter for folder-notes' installed presentation. The plugin's
 * has-folder-note class admits the folder (including exclusions/detachment);
 * its settings resolve the same file that clicking that folder opens. */
export interface FolderNotesSettings {folderNoteName?:string;folderNoteType?:string;storageLocation?:string;supportedFileTypes?:string[]}
export function folderNotePath(folderPath:string,settings:FolderNotesSettings|undefined,exists:(path:string)=>boolean):string|undefined {
  if(!settings||typeof settings.folderNoteName!=='string'||!settings.folderNoteName||!['insideFolder','parentFolder'].includes(settings.storageLocation??''))return;
  const name=folderPath.split('/').at(-1)!;
  const fileName=settings.folderNoteName.replace('{{folder_name}}',name);
  const directory=settings.storageLocation==='parentFolder'?folderPath.split('/').slice(0,-1).join('/'):folderPath;
  const base=directory?`${directory}/${fileName}`:fileName;
  const primary=settings.folderNoteType??'.md',types=settings.supportedFileTypes??['md'];
  for(let type of [primary,...types.filter(t=>t!==primary.replace(/^\./,''))]){
    if(type==='excalidraw'||type==='.excalidraw'||type==='.ask')type='md';
    const path=base+(type.startsWith('.')?type:'.'+type);
    if(exists(path))return path;
  }
}
