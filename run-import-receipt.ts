import type {ImportSource} from './response-command';

export interface RunImportReceipt extends ImportSource {version:1;bindingId:string;messageId:string;runId:string}
const prefix='<!-- t3-run-import:';
/** A small note-local receipt survives final saves, renames and Sync. */
export function runImportReceipt(value:RunImportReceipt){return prefix+encodeURIComponent(JSON.stringify(value)).replace(/-/g,'%2D')+' -->';}
/** Recognize only complete receipts; malformed or unrelated comments stay text. */
export function* runImportReceipts(document:string):Generator<{receipt:RunImportReceipt;from:number;to:number}> {
  if(!document.includes(prefix))return;
  for(const match of document.matchAll(/<!-- t3-run-import:([^\n]{1,4096}?) -->/g))try{
    const value=JSON.parse(decodeURIComponent(match[1]));
    if(value?.version===1&&/^[0-9a-f-]{36}$/i.test(value.bindingId)&&(['threadId','projectId','environmentId','messageId','runId'] as const).every(key=>typeof value[key]==='string'&&value[key]))yield {receipt:value,from:match.index!,to:match.index!+match[0].length};
  }catch{/* Invalid Markdown comments cannot identify an imported run. */}
}
export function findRunImport(document:string,source:ImportSource,messageId:string):RunImportReceipt|undefined {
  for(const {receipt} of runImportReceipts(document))if(receipt.messageId===messageId&&(['threadId','projectId','environmentId'] as const).every(key=>receipt[key]===source[key]))return receipt;
}
