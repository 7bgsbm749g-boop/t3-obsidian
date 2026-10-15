import type {ImportSource} from './response-command';

export interface RunImportReceipt extends ImportSource {version:1;bindingId:string;messageId:string;runId:string}
const prefix='<!-- t3-run-import:';
/** A small note-local receipt survives final saves, renames and Sync. */
export function runImportReceipt(value:RunImportReceipt){return prefix+encodeURIComponent(JSON.stringify(value)).replace(/-/g,'%2D')+' -->';}
export function findRunImport(document:string,source:ImportSource,messageId:string):RunImportReceipt|undefined {
  for(const match of document.matchAll(/<!-- t3-run-import:([^\n]{1,4096}?) -->/g))try{
    const value=JSON.parse(decodeURIComponent(match[1]));
    if(value.version===1&&/^[0-9a-f-]{36}$/i.test(value.bindingId)&&typeof value.runId==='string'&&value.runId&&value.messageId===messageId&&(['threadId','projectId','environmentId'] as const).every(key=>value[key]===source[key]))return value;
  }catch{/* Invalid Markdown comments cannot identify an imported run. */}
}
