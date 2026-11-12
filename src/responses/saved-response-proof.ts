import {localFinalIdentity} from './local-final-cache';
import {hasResponseMarkers} from '../conversations/inline-thread';
import {unpackText,type SmartSendData} from '../notes/smart-send';
import type {ResponseRequest} from './response-model';
import type {ResponseBindingData} from './response-binding-data';

/** A portable completion hint alone is not a local save receipt. Require its
 * exact retained output, once, in the routed note without a response anchor. */
export async function savedResponseProof(request:ResponseRequest,document:string,bindings:ResponseBindingData,data:SmartSendData):Promise<boolean>{
  // A body receipt does not prove that a pending checked note proposal saved.
  if(request.localStage)return false;
  const entry=bindings[request.id],receipt=entry?.completion;
  if(!receipt||receipt.identity!==localFinalIdentity(request)||receipt.identity!==localFinalIdentity(entry.request)||entry.request.notePath!==request.notePath||hasResponseMarkers(document,request.id))return false;
  const response=data.responses[`${request.id}:${receipt.outputHash}`];
  if(!response||response.body!==receipt.outputHash||data.notes[response.noteId]?.path!==request.notePath||data.notes[response.noteId]?.deleted)return false;
  const packed=data.bodies[receipt.outputHash];if(!packed||packed.hash!==receipt.outputHash)return false;
  let body:string;try{body=await unpackText(packed);}catch{return false;}if(!body.trim())return false;
  const at=document.indexOf(body);
  return at>=0&&document.indexOf(body,at+1)<0;
}
