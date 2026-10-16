import {responseOwnsActiveTurn,threadIsActive} from './thread-target';

export interface NoteSteeringCandidate {
  id:string;notePath:string;threadId:string;projectId:string;environmentId:string;
  state?:{turnId?:string;turnIds?:string[];status?:string};
}
export interface NoteSteeringDestination {notePath:string;threadId:string;projectId:string;environmentId:string}

/** Callers supply only responses whose intact anchors are still in the note.
 * A saved routing identity alone cannot prove ownership after a reload. */
export function noteSteeringTarget<T extends NoteSteeringCandidate>(thread:any,destination:NoteSteeringDestination,candidates:readonly T[],preferredId?:string):T|undefined {
  if(!threadIsActive(thread))return;
  if(thread.hasPendingApprovals||thread.hasPendingUserInput)throw Error('This conversation is waiting for approval or input. Resolve it in T3 before sending.');
  const attached=candidates.filter(candidate=>candidate.notePath===destination.notePath&&candidate.threadId===destination.threadId&&candidate.projectId===destination.projectId&&candidate.environmentId===destination.environmentId);
  const matches=attached.filter(candidate=>responseOwnsActiveTurn(thread,candidate.state)&&!['complete','interrupted','error','cancelled'].includes(candidate.state?.status??''));
  if(preferredId){const selected=matches.find(candidate=>candidate.id===preferredId);if(!selected)throw Error('The selected response no longer owns the active turn. Reopen the chooser before sending.');return selected;}
  if(matches.length>1)throw Error('Several responses in this note follow the active turn. Choose the response to steer. No message was sent.');
  if(matches.length===1)return matches[0];
  if(attached.some(candidate=>!candidate.state?.turnId&&!candidate.state?.turnIds?.length&&!['complete','interrupted','error','cancelled'].includes(candidate.state?.status??'')))throw Error('The response is reconnecting. Wait for its active turn to load before sending again.');
}
