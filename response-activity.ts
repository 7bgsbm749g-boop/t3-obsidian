import type {InlineThreadState} from './inline-thread';
import {responseTools} from './response-tools';

const text=(value:unknown)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,120):'';
/** Canonical lifecycle records, never assistant prose or another turn's tools.
 * Snapshots may omit starts or arrive out of order; terminal identities win.
 * Idless legacy records are conservative and can only offer a fallback. */
export function responseActivityLabel(state:InlineThreadState,turnId:string):string {
  if(!turnId)return 'Working';
  const current=responseTools(state,[turnId]).filter(tool=>tool.status==='inProgress').at(-1);
  if(current)return current.label;
  return state.messages.some(m=>m.turnId===turnId&&m.role==='reasoning'&&m.streaming)?'Thinking':'Working';

}

export function responseActivityRow(label='Working'):string {
  const escaped=text(label).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  return `<span class="send-to-t3-response-activity" role="status" aria-live="polite"><strong>${escaped}</strong> <span class="send-to-t3-inline-spinner" aria-label="Loading"></span></span>`;
}
