import {folderLinkForPath,type FolderLink} from './folder-link';
import type {Project} from './bridge';

export type FolderCommand = {version:1;id:string;folderPath:string} & (
  {kind:'inspect-folder'|'unlink-folder'} |
  {kind:'link-folder';projectId:string;connectionId:string;environmentId:string;mode:'project'|'self';relink:boolean}
);
export interface FolderCommandResult {
  id:string;ok:boolean;vaultId:string;folderPath:string;directLink:FolderLink|null;effectiveLink:FolderLink|null;
  routing:'linked-project'|'new-folder-project'|'vault-project-setup';
}
export function isFolderCommand(value:{kind?:string}):value is FolderCommand {
  return ['inspect-folder','link-folder','unlink-folder'].includes(value.kind??'');
}
export function safeFolderPath(value:unknown):value is string {
  return value==='/'||typeof value==='string'&&value.length>0&&value.length<=2000&&value===value.trim()&&!/[\\\x00-\x1f\x7f:]/.test(value)&&value.split('/').every(part=>!!part&&part!=='.'&&part!=='..'&&!part.startsWith('.'));
}
export function validateFolderCommand(value:any):FolderCommand {
  if(value?.version!==1||!isFolderCommand(value??{})||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id??''))throw Error('Invalid Obsidian folder command.');
  if(!safeFolderPath(value.folderPath))throw Error('Choose an existing vault-relative folder; / means the vault root.');
  const fields=['version','id','kind','folderPath',...(value.kind==='link-folder'?['projectId','connectionId','environmentId','mode','relink']:[])];
  if(Object.keys(value).some(key=>!fields.includes(key)))throw Error('Unexpected folder command arguments.');
  if(value.kind==='link-folder'){
    for(const key of ['projectId','connectionId','environmentId'])if(typeof value[key]!=='string'||!value[key].trim()||value[key]!==value[key].trim()||value[key].length>200||/[\x00-\x1f\x7f]/.test(value[key]))throw Error(`Linking requires an explicit ${key}.`);
    if(!['project','self'].includes(value.mode)||typeof value.relink!=='boolean')throw Error('Choose project or self link mode and an explicit relink preference.');
    if(value.folderPath==='/'&&value.mode!=='self')throw Error('The vault root requires self mode and an existing project for this vault.');
  }
  return value;
}
export function inspectFolderLinks(id:string,vaultId:string,folderPath:string,links:FolderLink[]):FolderCommandResult {
  const directLink=links.find(link=>link.folderPath===folderPath)??null;
  // A hypothetical child follows exactly the same nearest-ancestor rule as a note.
  const effectiveLink=folderLinkForPath(links,folderPath==='/'?'command-inspection.md':folderPath+'/command-inspection.md')??null;
  const routing=effectiveLink&&effectiveLink.folderPath!=='/'||folderPath==='/'&&effectiveLink?'linked-project':folderPath!=='/'?'new-folder-project':'vault-project-setup';
  return JSON.parse(JSON.stringify({id,ok:true,vaultId,folderPath,directLink,effectiveLink,routing}));
}
interface Prepared {before:FolderLink|null;after:FolderLink|null;project?:Project;result:FolderCommandResult}
export interface FolderCommandJournal {command:FolderCommand;prepared?:Prepared;result?:FolderCommandResult}
export interface FolderCommandHost {
  vaultId:string;links():FolderLink[];validateFolder(path:string):void;
  refresh():Promise<void>;resolve(command:Extract<FolderCommand,{kind:'link-folder'}>):Promise<Project>;
  read(id:string):Promise<FolderCommandJournal|undefined>;write(id:string,journal:FolderCommandJournal):Promise<void>;
  save(link:FolderLink,project:Project):Promise<void>;unlink(path:string):Promise<void>;
}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function canonical(value:any):string {return value&&typeof value==='object'?JSON.stringify(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):JSON.stringify(value);}
/** Persist exact intent before mutation; recover a save whose acknowledgement was lost. */
export async function executeFolderCommand(input:FolderCommand,host:FolderCommandHost):Promise<FolderCommandResult> {
  const command=validateFolderCommand(input);
  let journal=await host.read(command.id);
  if(journal&&!same(journal.command,command))throw Error('This request ID already belongs to different input.');
  if(journal?.result)return journal.result;
  if(!journal){journal={command};await host.write(command.id,journal);}
  await host.refresh();host.validateFolder(command.folderPath);
  const inspect=()=>inspectFolderLinks(command.id,host.vaultId,command.folderPath,host.links());
  if(command.kind==='inspect-folder'){
    const result=inspect();await host.write(command.id,{...journal,result});return result;
  }
  const current=()=>host.links().find(link=>link.folderPath===command.folderPath)??null;
  if(journal.prepared&&same(current(),journal.prepared.after)){
    const result=journal.prepared.result;await host.write(command.id,{...journal,result});return result;
  }
  const before=journal.prepared?.before??current();
  if(journal.prepared&&!same(current(),journal.prepared.before))throw Error('The folder link changed since this request was prepared. Inspect it and use a new request ID.');
  const project=command.kind==='link-folder'?await host.resolve(command):undefined;
  await host.refresh();host.validateFolder(command.folderPath);
  if(!same(current(),before))throw Error('The folder link changed while verifying the destination. Inspect it and use a new request ID.');
  let after:FolderLink|null=null;
  if(command.kind==='link-folder'){
    const unchanged=before?.projectId===project!.id&&before.connectionId===(project!.connectionId??'')&&before.self===(command.mode==='self')&&(!before.environmentId||before.environmentId===command.environmentId)&&before.workspaceRoot===project!.workspaceRoot;
    if(before&&!unchanged&&!command.relink)throw Error('This folder already has a different direct link. Use --relink to deliberately replace it.');
    after={id:unchanged?before!.id:command.id,folderPath:command.folderPath,connectionId:project!.connectionId??'',projectId:project!.id,projectTitle:project!.title,workspaceRoot:project!.workspaceRoot,self:command.mode==='self',vaultId:host.vaultId,environmentId:command.environmentId};
  }
  if(journal.prepared&&!same(after,journal.prepared.after))throw Error('Verified project metadata changed since preparation. Inspect it and use a new request ID.');
  const links=host.links().filter(link=>link.folderPath!==command.folderPath);if(after)links.push(after);
  const result=inspectFolderLinks(command.id,host.vaultId,command.folderPath,links);
  journal={command,prepared:{before,after,project,result}};await host.write(command.id,journal);
  if(after)await host.save(after,project!);else await host.unlink(command.folderPath);
  if(!same(current(),after))throw Error('A newer folder edit took precedence while saving. Inspect the current destination and use a new request ID.');
  await host.write(command.id,{...journal,result});return result;
}
