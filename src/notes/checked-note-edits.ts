import {isRecord} from '../shared/values';
import {contentHash} from '../responses/completion';
import {changedEdits,mergeSavedEdits} from '../responses/coordinated-merge';
import {responseIds,responseFrame} from '../responses/response-container';
import {safeNotePath,type ResponseRequest} from '../responses/response-model';
import type {CommandFiles,CommandRoute} from './connect-command-host';

const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export interface NoteEditCommand {version:1;id:string;kind:'prepare-note-edit'|'submit-note-edit'|'note-edit-status'|'cancel-note-edit'|'create-note'|'rename-note';destination?:string;notePath?:string;bindingId?:string;editId?:string;originalHash?:string;hash?:string;proposed?:string}
export interface EditSnapshot {editId:string;notePath:string;bindingId?:string;original:string;originalHash:string;createdAt:number;status:'prepared'|'submitted'|'saved'|'cancelled';proposedHash?:string}
export type CheckedStage=NonNullable<ResponseRequest['localStage']>;
interface EditIO {
  load(id:string):Promise<EditSnapshot|undefined>;save(snapshot:EditSnapshot):Promise<void>;
  read(notePath:string):Promise<string|undefined>;binding(id:string):ResponseRequest|undefined;
  files(route:CommandRoute):Promise<CommandFiles>;
  attach(binding:ResponseRequest,stage:CheckedStage,attached:()=>Promise<void>):Promise<void>;
  detach?(binding:ResponseRequest,editId:string,expectedHash:string,detached:()=>Promise<void>):Promise<void>;
  commit(notePath:string,before:string,after:string):Promise<boolean>;
  create?(notePath:string,content:string):Promise<void>;rename?(notePath:string,destination:string,expectedHash:string):Promise<void>;
  remember?(notePath:string,id:string,before:string,after:string):Promise<void>;
  now?():number;
}
export function isNoteEditCommand(input:unknown):input is NoteEditCommand{return isRecord(input)&&['prepare-note-edit','submit-note-edit','note-edit-status','cancel-note-edit','create-note','rename-note'].includes(String(input.kind));}
export function validateNoteEditCommand(input:unknown):NoteEditCommand {
  if(!isRecord(input)||input.version!==1||!uuid(input.id)||!isNoteEditCommand(input))throw Error('Invalid checked note edit.');
  if(input.kind==='create-note'){
    if(!safeNotePath(input.notePath)||typeof input.proposed!=='string'||new TextEncoder().encode(input.proposed).length>1_000_000||responseIds(input.proposed).length)throw Error('Create an ordinary Markdown note of at most 1 MB at an exact new path.');
    return input;
  }
  if(input.kind==='rename-note'){if(!safeNotePath(input.notePath)||!safeNotePath(input.destination)||input.destination===input.notePath||!hash(input.originalHash))throw Error('Rename requires exact source and destination paths and the current note checksum.');return input;}
  if(input.kind==='prepare-note-edit'){
    if(!safeNotePath(input.notePath)||input.bindingId!==undefined&&!uuid(input.bindingId))throw Error('Choose the exact note and optional active reply binding.');
  }else if(!uuid(input.editId))throw Error('Choose the exact prepared edit ID.');
  if(input.kind==='submit-note-edit'&&(!hash(input.originalHash)||typeof input.proposed!=='string'||new TextEncoder().encode(input.proposed).length>1_000_000))throw Error('Submit the original checksum and a complete proposed note of at most 1 MB.');
  if(input.kind==='cancel-note-edit'&&!hash(input.hash))throw Error('Review the current note checksum before withdrawing its proposal.');
  return input;
}
function protect(original:string,proposed:string){
  const ids=responseIds(original);if(JSON.stringify(ids)!==JSON.stringify(responseIds(proposed)))throw Error('Do not add, remove or reorder active reply boundaries.');
  for(const id of ids){const a=responseFrame(original,id),b=responseFrame(proposed,id);if(!a||!b||original.slice(a.from,a.to)!==proposed.slice(b.from,b.to))throw Error('Do not edit an active reply block.');}
}
function merged(original:string,current:string,proposed:string){const result=mergeSavedEdits(original,current,changedEdits(original,proposed));if(!result.ok)throw Error(result.reason);return result.text;}
export function editPath(stage:CheckedStage,kind:'original'|'proposed'){
  if(!stage.editId||!stage.transport)throw Error('This old staged edit needs to be prepared again with the connected client.');
  return `${stage.transport.base}/edits/${stage.editId}/${kind==='original'?stage.originalHash:stage.stagedHash}.${kind}.md`;
}
export async function checkedStageDraft(document:string,request:ResponseRequest,files:CommandFiles){
  const stage=request.localStage;if(!stage)return document;
  const original=await files.read(editPath(stage,'original')),proposed=await files.read(editPath(stage,'proposed'));
  if(original===undefined||proposed===undefined||contentHash(original)!==stage.originalHash||contentHash(proposed)!==stage.stagedHash)throw Error('The checked note edit is incomplete or changed.');
  protect(original,proposed);return merged(original,document,proposed);
}

/** Proposals are data. Only the existing Obsidian editor/final-save port can
 * apply them; this service never reads or writes a local file. */
export class CheckedNoteEdits {
  constructor(private io:EditIO){}
  async execute(input:unknown,route:CommandRoute):Promise<Record<string,unknown>>{
    const command=validateNoteEditCommand(input);
    if(command.kind==='create-note'){if(!this.io.create)throw Error('This client cannot create notes.');await this.io.create(command.notePath!,command.proposed!);return {id:command.id,ok:true,notePath:command.notePath,status:'saved'};}
    if(command.kind==='rename-note'){if(!this.io.rename)throw Error('This client cannot rename notes.');await this.io.rename(command.notePath!,command.destination!,command.originalHash!);return {id:command.id,ok:true,notePath:command.destination,status:'saved'};}
    if(command.kind==='prepare-note-edit'){
      const prior=await this.io.load(command.id);
      if(prior){if(prior.notePath!==command.notePath||prior.bindingId!==command.bindingId)throw Error('This edit ID already belongs to another note.');return {id:command.id,ok:true,...prior};}
      const notePath=command.notePath!,document=await this.io.read(notePath);if(document===undefined)throw Error('The current note is unavailable.');
      if(new TextEncoder().encode(document).length>1_000_000)throw Error('This note is too large for a checked edit.');
      const active=responseIds(document);
      if(command.bindingId){const binding=this.io.binding(command.bindingId);if(!binding||binding.notePath!==notePath||!active.includes(command.bindingId))throw Error('The reply finished or its destination changed. Prepare the note again.');if(binding.localStage)throw Error('A proposed edit is already waiting for this reply to save.');}
      else if(active.length)throw Error('Choose the active reply binding before editing this note.');
      const snapshot:EditSnapshot={editId:command.id,notePath,...(command.bindingId?{bindingId:command.bindingId}:{}),original:document,originalHash:contentHash(document),createdAt:this.io.now?.()??Date.now(),status:'prepared'};
      await this.io.save(snapshot);return {id:command.id,ok:true,...snapshot,protectedReplyIds:active};
    }
    const snapshot=await this.io.load(command.editId!);if(!snapshot)throw Error('The prepared edit is unavailable on this client.');
    const binding=snapshot.bindingId?this.io.binding(snapshot.bindingId):undefined,notePath=binding?.notePath??snapshot.notePath;
    if(command.kind==='note-edit-status'){const current=await this.io.read(notePath);return {id:command.id,ok:true,editId:snapshot.editId,notePath,bindingId:snapshot.bindingId,status:snapshot.status,originalHash:snapshot.originalHash,proposedHash:snapshot.proposedHash,...(current!==undefined?{currentHash:contentHash(current)}:{})};}
    if(command.kind==='cancel-note-edit'){
      if(snapshot.status==='saved')throw Error('This edit was already saved. Prepare a new edit to change its content.');
      if(snapshot.status==='cancelled')return {id:command.id,ok:true,editId:snapshot.editId,status:snapshot.status};
      const current=await this.io.read(notePath);if(current===undefined||contentHash(current)!==command.hash)throw Error('The reviewed note changed.');
      const cancelled:EditSnapshot={...snapshot,status:'cancelled',notePath};
      if(snapshot.status==='submitted'){
        if(!binding||binding.localStage?.editId!==snapshot.editId||!this.io.detach)throw Error('The reply no longer owns this pending proposal. Inspect its saved outcome.');
        await this.io.detach(binding,snapshot.editId,command.hash,()=>this.io.save(cancelled));
      }else await this.io.save(cancelled);
      return {id:command.id,ok:true,editId:snapshot.editId,status:'cancelled'};
    }
    if(snapshot.status==='cancelled')throw Error('This proposal was withdrawn. Prepare a new edit.');
    const proposed=command.proposed!,proposedHash=contentHash(proposed);
    if(snapshot.originalHash!==command.originalHash)throw Error('The original note checksum does not match.');
    if(snapshot.status!=='prepared'){
      if(snapshot.proposedHash!==proposedHash)throw Error('This edit was already submitted with different content.');
      return {id:command.id,ok:true,editId:snapshot.editId,status:snapshot.status};
    }
    protect(snapshot.original,proposed);
    const current=await this.io.read(snapshot.notePath);if(current===undefined)throw Error('The note was moved, deleted or is unavailable.');
    if(!snapshot.bindingId&&responseIds(current).length)throw Error('A reply started in this note. Prepare an edit for its active binding.');
    const next=merged(snapshot.original,current,proposed);
    if(snapshot.bindingId){
      const binding=this.io.binding(snapshot.bindingId);if(!binding||binding.notePath!==snapshot.notePath||!responseIds(current).includes(binding.id))throw Error('The reply finished or moved before submission. Prepare a new edit; the proposal was not applied.');
      const files=await this.io.files(route),stage:CheckedStage={editId:snapshot.editId,originalHash:snapshot.originalHash,stagedHash:proposedHash,transport:route};
      await files.write(editPath(stage,'original'),snapshot.original);await files.write(editPath(stage,'proposed'),proposed);
      snapshot.status='submitted';snapshot.proposedHash=proposedHash;
      await this.io.attach(binding,stage,()=>this.io.save(snapshot));
    }else{
      if(responseIds(current).length)throw Error('A reply started in this note. Prepare an edit for its active binding.');
      if(!await this.io.commit(snapshot.notePath,current,next))throw Error('The note changed before saving. The proposal was not applied.');
      snapshot.status='saved';snapshot.proposedHash=proposedHash;await this.io.save(snapshot);
      await this.io.remember?.(snapshot.notePath,snapshot.editId,current,next);
    }
    return {id:command.id,ok:true,editId:snapshot.editId,notePath:snapshot.notePath,status:snapshot.status};
  }
}
