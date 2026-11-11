import type {InlineThreadState} from '../conversations/inline-thread';
import {responseToolGroups,currentResponseToolGroup} from './response-tools';

const text=(value:unknown)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,120):'';
/** Canonical lifecycle records, never assistant prose or another turn's tools.
 * Snapshots may omit starts or arrive out of order; terminal identities win.
 * Idless legacy records are conservative and can only offer a fallback. */
export function responseActivityLabel(state:InlineThreadState,turnId:string):string {
  if(!turnId)return 'Thinking';
  const group=responseToolGroups(state,[turnId]).at(-1),thought=group?.thoughts?.at(-1);
  if(thought&&!state.messages.some(message=>message.turnId===turnId&&message.role!=='reasoning'&&(Date.parse(message.createdAt??'')||0)>(Date.parse(thought.createdAt??'')||0))){const preview=liveThoughtLine(thought.text);if(preview)return preview;}
  const current=currentResponseToolGroup(state,turnId);
  if(current)return current.active?current.tool.activeLabel:current.tool.label;
  return 'Thinking';

}

/** Only the public reasoning field enters this preview. */
export function liveThoughtLine(markdown:string):string {
 const heading=/^\s*\*\*([^*\r\n]+)\*\*[ \t]*\r?(?:\n|$)/.exec(markdown)?.[1];
 const value=(heading??markdown).replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[ \t]*(?:#{1,6}|[-*+]|\d+\.)[ \t]+/gm,'').replace(/`+|\*\*|~~/g,'').replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g,'$1$2').replace(/\s+/g,' ').trim();
 if(heading!==undefined)return value;
 const end=/[.?!]["'”’)]?(?=\s)/.exec(value);return end?value.slice(0,end.index+end[0].length):value;
}
export function responseActivityRow(label='Thinking',icon='brain',groupId?:string):string {
  const escaped=text(label).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const glyph=/^[a-z0-9-]+$/.test(icon)?icon:'brain';
  const tag=groupId?'button':'span';
  const attributes=groupId?`type="button" data-t3-open-tool-group="${encodeURIComponent(groupId)}"`:'role="status" aria-live="polite"';
  return `<${tag} class="send-to-t3-response-activity" ${attributes}><span data-t3-tool-icon="${glyph}" aria-hidden="true"></span><span>${escaped}</span> <span class="send-to-t3-inline-spinner" aria-label="Loading"></span></${groupId?'button':'span'}>`;
}
