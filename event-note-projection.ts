import {sourceProjection,type SmartSendData} from './smart-send';
import {responseIds} from './response-container';
import type {ResponseRequest} from './response-model';
import type {NoteEventSnapshot} from './event-subscriptions';

/** Compare ordinary source on both sides of an event. Provenance is saved
 * before a final write and may reach a Sync receiver after the note itself. */
export async function projectEventNote(note:NoteEventSnapshot,data:SmartSendData,bindings:readonly ResponseRequest[]):Promise<NoteEventSnapshot>{
  const noteId=Object.entries(data.notes).find(([,identity])=>identity.path===note.path&&!identity.deleted)?.[0]??'';
  const content=(await sourceProjection(data,noteId,note.content)).text;
  const candidates=new Set([...responseIds(note.content),...bindings.filter(binding=>binding.notePath===note.path).map(binding=>binding.id)]),known=new Set(Object.keys(data.responses).map(key=>key.split(':')[0]));
  const pendingResponseIds=[...candidates].filter(id=>!known.has(id));
  return {...note,content,...(pendingResponseIds.length?{pendingResponseIds}:{})};
}
