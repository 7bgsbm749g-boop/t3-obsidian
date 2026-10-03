import type {NativeResponseView} from '../native-response-view';
/** Isolated-fixture diagnostics only; never registered in the product. */
export function traceNativeView(adapter:NativeResponseView,events:unknown[],label:string){
  const internal=adapter as any;
  const record=(event:string,extra?:unknown)=>{let local:string;try{local=adapter.saved();}catch(error){local=String(error);}events.push({label,event,base:internal.base,diskBase:internal.diskBase,ownSave:internal.ownSave,local,extra});};
  const read=internal.readSaved;internal.readSaved=async()=>{const result=await read();record('disk-read',result);return result;};
  const incoming=internal.incoming;internal.incoming=function(text:string,clear:boolean){record('incoming-before',text);try{return incoming.call(this,text,clear);}finally{record('incoming-after');}};
  const save=internal.saveWrapper;internal.saveWrapper=async function(clear:boolean){record('save-before');try{return await save(clear);}finally{record('save-after');}};adapter.view.save=internal.saveWrapper;
}
