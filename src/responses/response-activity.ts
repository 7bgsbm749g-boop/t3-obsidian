import type {InlineThreadState} from '../conversations/inline-thread';
import {currentResponseToolGroup} from './response-tools';

const text=(value:unknown)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,120):'';
/** Canonical lifecycle records, never assistant prose or another turn's tools.
 * Snapshots may omit starts or arrive out of order; terminal identities win.
 * Idless legacy records are conservative and can only offer a fallback. */
export function responseActivityLabel(state:InlineThreadState,turnId:string):string {
  if(!turnId)return 'Thinking';
  const current=currentResponseToolGroup(state,turnId);
  if(current)return current.active?current.tool.activeLabel:current.tool.label;
  return 'Thinking';

}

export function responseActivityRow(label='Thinking',icon='brain'):string {
  const escaped=text(label).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const glyph=/^[a-z0-9-]+$/.test(icon)?icon:'brain';
  return `<span class="send-to-t3-response-activity" role="status" aria-live="polite"><span data-t3-tool-icon="${glyph}" aria-hidden="true"></span><span>${escaped}</span> <span class="send-to-t3-inline-spinner" aria-label="Loading"></span></span>`;
}
