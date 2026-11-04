import type {MarkdownView} from 'obsidian';

/** Canonical text and its checked storage baseline, rather than the editor's
 * transient response projection or compact tool placeholders. */
export interface NativeDocumentState {
  read():string;
  baseline():string|undefined;
  adopt(text:string):boolean;
}
const documents=new WeakMap<object,{file:MarkdownView['file'];state:NativeDocumentState}>();
export function nativeDocumentState(view:Pick<MarkdownView,'file'>):NativeDocumentState|undefined {
  const entry=documents.get(view);return entry&&entry.file===view.file?entry.state:undefined;
}
export function registerNativeDocumentState(view:Pick<MarkdownView,'file'>,state:NativeDocumentState):()=>void {
  const entry={file:view.file,state};documents.set(view,entry);
  return ()=>{if(documents.get(view)===entry)documents.delete(view);};
}
