import {relativeCodebasePath,type CodebaseScope} from './codebase-core';
import {hasControlCharacters} from '../shared/values';

/** A file's parent is an RPC cwd, not a registered project or a folder link. */
export function filesystemReference(value:string,environmentId:string){
  const parsed=projectLink(value);if(!parsed)return undefined;
  const path=parsed.path;
  if(!/^(?:\/(?!\/)|[a-z]:\/)/i.test(path)||hasControlCharacters(path))return undefined;
  const parts=path.replace(/^[a-z]:\//i,'/').slice(1).split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'))return undefined;
  const slash=path.lastIndexOf('/'),parent=path.slice(0,slash),root=!parent?'/':/^[a-z]:$/i.test(parent)?parent+'/':parent,name=path.slice(slash+1);
  const scope:CodebaseScope={environmentId,projectId:'',title:root,root,filesystem:true};
  try{return {scope,path:relativeCodebasePath(name)};}catch{return undefined;}
}

export function validFilesystemScope(scope:CodebaseScope){
  const target=encodeURI(scope.root.replace(/\/?$/,'/')+'identity').replace(/[?#]/g,value=>encodeURIComponent(value));
  return scope.filesystem===true&&scope.projectId===''&&!scope.threadId&&filesystemReference(target,scope.environmentId)?.scope.root===scope.root;
}

export function projectMarkdownLink(scope:CodebaseScope,path:string,name:string){
  const target=encodeURI(scope.root.replace(/\\/g,'/').replace(/\/$/,'')+'/'+path).replace(/[?#]/g,value=>encodeURIComponent(value));
  return `[${name.replace(/[\\[\]]/g,value=>'\\'+value)}](<${target}>)`;
}

/** Parse a local reference without changing the text stored in the note. */
export function projectLink(value:string){
  let path=value.replace(/^sandbox:/,'');
  if(/^(?!file:)[a-z][a-z0-9+.-]*:/i.test(path)&&! /^[a-z]:[\\/]/i.test(path))return undefined;
  if(path.startsWith('//'))return undefined;
  const hash=path.indexOf('#'),subpath=hash<0?undefined:path.slice(hash);
  if(hash>=0)path=path.slice(0,hash);
  if(/^file:/i.test(path))try{const url=new URL(path);if(url.hostname&&url.hostname!=='localhost')return undefined;path=path.replace(/^file:(?:\/\/(?:localhost)?)?/i,'').split('?')[0];if(/^\/[a-z]:\//i.test(path))path=path.slice(1);}catch{return undefined;}
  try{path=decodeURIComponent(path);}catch{return undefined;}
  path=path.replace(/\\/g,'/');
  const line=/:(\d+)(?::(\d+))?$/.exec(path);
  if(line)path=path.slice(0,line.index);
  return {path,subpath,line:line?Math.max(0,Number(line[1])-1):undefined,column:line?.[2]?Math.max(0,Number(line[2])-1):undefined};
}
function normalized(path:string){const clean=path.replace(/\\/g,'/');return /^(?:\/|[a-z]:\/)$/i.test(clean)?clean:clean.replace(/\/$/,'');}
function directoryPrefix(root:string){return root.endsWith('/')?root:root+'/';}
export function projectPathRoutes(value:string,scopes:CodebaseScope[]){
  const link=projectLink(value);if(!link){const raw=value.replace(/^sandbox:/,'').replace(/^file:\/\/(?:localhost)?/i,'').replace(/\\/g,'/').replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded;}});const owned=scopes.some(scope=>{let root=normalized(scope.root),path=root.startsWith('/')&&!raw.startsWith('/')?'/'+raw:raw;if(/^[a-z]:\//i.test(root)){root=root.toLowerCase();path=path.toLowerCase();}return path===root||path.startsWith(directoryPrefix(root));});return {owned,matches:[] as {scope:CodebaseScope;path:string}[]};}
  const matches:{scope:CodebaseScope;path:string}[]=[],roots:{scope:CodebaseScope;root:string;value:string}[]=[];
  for(const scope of scopes){let root=normalized(scope.root),path=link.path;if(root.startsWith('/')&&!path.startsWith('/'))path='/'+path;const windows=/^[a-z]:\//i.test(root),compareRoot=windows?root.toLowerCase():root,comparePath=windows?path.toLowerCase():path;if(comparePath===compareRoot||comparePath.startsWith(directoryPrefix(compareRoot)))roots.push({scope,root,value:path});}
  const longest=new Map<string,number>();for(const r of roots)longest.set(r.scope.environmentId,Math.max(longest.get(r.scope.environmentId)??0,r.root.length));
  for(const {scope,root,value} of roots.filter(r=>r.root.length===longest.get(r.scope.environmentId)))try{const path=value.slice(directoryPrefix(root).length);relativeCodebasePath(path);matches.push({scope,path});}catch{/* Owned invalid paths cannot create vault notes. */}
  return {owned:roots.length>0,matches,link};
}
