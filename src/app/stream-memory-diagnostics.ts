import {diagnosticEnabled,logEvent} from './diagnostics';

export const MEMORY_SAMPLE_INTERVAL_MS=5000;
export const MEMORY_CHECKPOINTS_PER_INTERVAL=8;
export type MemoryCheckpoint='sample'|'start'|'end'|'view-open'|'view-close'|'save'|'dispose'|'manual'|'enabled';
type Fields=Record<string,unknown>;
/** Numeric metadata only. Never retain a supplier, editor, note or stream. */
export class StreamMemoryDiagnostics {
  private sampledAt=-Infinity;
  private checkpointAt=-Infinity;
  private checkpoints=0;
  private skipped=0;
  constructor(private enabled=()=>diagnosticEnabled('memory.streaming'),private emit=(fields:Fields)=>logEvent('memory.streaming',fields),private now=()=>performance.now(),private heap=readJSHeap){}
  reset(){this.sampledAt=-Infinity;this.checkpointAt=-Infinity;this.checkpoints=0;this.skipped=0;}
  sample(checkpoint:MemoryCheckpoint,fields:()=>Fields=()=>({})){
    // Do not read the clock, heap or counters when disabled.
    if(!this.enabled())return false;
    try{
      const now=this.now();
      if(checkpoint==='sample'){
        if(now-this.sampledAt<MEMORY_SAMPLE_INTERVAL_MS)return false;
      }else{
        if(now-this.checkpointAt>=MEMORY_SAMPLE_INTERVAL_MS){this.checkpointAt=now;this.checkpoints=0;}
        if(this.checkpoints>=MEMORY_CHECKPOINTS_PER_INTERVAL){this.skipped++;return false;}
        this.checkpoints++;
      }
      // Explicit checkpoints also satisfy the next periodic sample.
      this.sampledAt=now;
      const counters=fields();
      this.emit({checkpoint,...safeMemoryFields(counters),heap:this.heap(),processRSS:'unsupported',cgroupCharge:'unsupported',skippedCheckpoints:this.skipped});this.skipped=0;
      return true;
    }catch{return false;}
  }
}
const ids=new Set(['bindingId','threadId','turnId','monitorId','streamId']);
/** A second boundary prevents accidental text/credentials in instrumentation. */
export function safeMemoryFields(fields:Fields){
  const result:Fields={};
  for(const [key,value] of Object.entries(fields).slice(0,40)){
    if(/token|secret|password|credential|cookie|authorization/i.test(key))continue;
    if(ids.has(key)&&typeof value==='string')result[key]=value.slice(0,128);
    else if(typeof value==='number'&&Number.isFinite(value)&&/^[a-zA-Z][a-zA-Z0-9]*(?:Count|Length|Characters|Ms|Sequence)$/.test(key))result[key]=Math.max(0,value);
  }
  return result;
}
export function readJSHeap():Fields {
  try{
    const memory:unknown=typeof performance==='undefined'?undefined:Reflect.get(performance,'memory');
    if(!memory||typeof memory!=='object')return {status:'unsupported'};
    const used:unknown=Reflect.get(memory,'usedJSHeapSize'),total:unknown=Reflect.get(memory,'totalJSHeapSize'),limit:unknown=Reflect.get(memory,'jsHeapSizeLimit');
    if(![used,total,limit].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0))return {status:'unsupported'};
    return {status:'supported',usedBytes:used,totalBytes:total,limitBytes:limit,scope:'renderer-js-heap',precision:'browser-reported'};
  }catch{return {status:'unsupported'};}
}
export const streamMemory=new StreamMemoryDiagnostics();
