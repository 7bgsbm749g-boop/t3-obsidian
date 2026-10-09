import {hostedPaths} from './hosted-inline';
import {leasePaths,type LeaseFiles,type LeaseIdentity,type LeaseRecord} from './inline-lease';
import {compactImportRecord,type ImportRecord} from './run-import';
import type {ImportSource} from './response-command';

export interface ImportRecordsPage {importRecords:ImportRecord[];nextCursor?:string}
const MAX_PAGE_BYTES=500_000,MAX_PAGE_RECORDS=64;
const matches=(request:any,vaultId:string,source:ImportSource)=>request?.vaultId===vaultId&&request.threadId===source.threadId&&request.projectId===source.projectId&&request.threadEnvironmentId===source.environmentId;

/** Filter on the owning host. Only matching leases cross the device boundary,
 * and bodies, save documents and private journal state never cross it. */
export async function readImportRecordsPage(files:Pick<LeaseFiles,'list'|'read'>,identity:LeaseIdentity,source:ImportSource,cursor?:string):Promise<ImportRecordsPage>{
  const paths=(await files.list(`${identity.directory}/leases`)).filter(path=>/\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/i.test(path)).sort();
  const importRecords:ImportRecord[]=[];let bytes=0,last:string|undefined;
  for(const path of paths){
    const id=path.slice(path.lastIndexOf('/')+1,-5);if(cursor&&id<=cursor)continue;
    const candidateBytes=await files.read(hostedPaths(identity.directory,id).request);
    if(candidateBytes){const candidate=JSON.parse(candidateBytes);if(candidate.id===id&&['vaultId','threadId','projectId','threadEnvironmentId'].every(key=>typeof candidate[key]==='string')&&!matches(candidate,identity.vaultId,source))continue;}
    // Legacy records can lack their immutable request file. Their complete
    // local lease remains authoritative; never trust a remote JSON preview.
    const raw=await files.read(leasePaths(identity.directory,id).record);if(!raw)continue;
    const record:LeaseRecord=JSON.parse(raw);if(record.request.id!==id||!matches(record.request,identity.vaultId,source))continue;
    const compact=compactImportRecord(record),size=new TextEncoder().encode(JSON.stringify(compact)).length;
    if(size>MAX_PAGE_BYTES)throw Error('The exact import evidence exceeds its read limit.');
    if(importRecords.length===MAX_PAGE_RECORDS||bytes+size>MAX_PAGE_BYTES)return {importRecords,nextCursor:last};
    importRecords.push(compact);bytes+=size;last=id;
  }
  return {importRecords};
}
