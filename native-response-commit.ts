import {contentHash} from './completion';
import {changedEdits} from './coordinated-merge';
import type {HostedInlineState} from './hosted-inline';

/** Private transport evidence, separate from the frequently polled lease.
 * Ranges protect every generated change in the verified saved document. */
export interface NativeCommitProof {
  version:1;bindingId:string;commitId:string;hash:string;document:string;
  ranges:Array<{from:number;to:number}>;
}
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function nativeCommitPath(directory:string,id:string,commitId:string){
  if(!uuid.test(id)||!uuid.test(commitId))throw Error('Invalid native commit identity.');
  return `${directory}/materializations/${id}/${commitId}.json`;
}
export function readNativeCommitProof(bytes:string,id:string,delivery:NonNullable<HostedInlineState['delivery']>):NativeCommitProof {
  if(!delivery.proofHash||contentHash(bytes)!==delivery.proofHash)throw Error('Native commit evidence checksum changed.');
  const proof:NativeCommitProof=JSON.parse(bytes);
  if(proof.version!==1||proof.bindingId!==id||proof.commitId!==delivery.commitId||proof.hash!==delivery.hash||typeof proof.document!=='string'||contentHash(proof.document)!==proof.hash||!Array.isArray(proof.ranges)||!proof.ranges.length)throw Error('Native commit evidence does not match this delivery.');
  let end=-1;
  for(const range of proof.ranges){
    if(!Number.isSafeInteger(range.from)||!Number.isSafeInteger(range.to)||range.from<0||range.to<range.from||range.to>proof.document.length||range.from<=end)throw Error('Invalid native commit evidence ranges.');
    end=range.to;
  }
  return proof;
}
/** Later ordinary edits and independent commits may change the note checksum.
 * Accept them only when unique unchanged lines prove all result ranges intact.
 * Ambiguous, touching, deleted or reordered results remain pending/conflicted. */
export function nativeCommitMatches(proof:NativeCommitProof,document:string){
  return changedEdits(proof.document,document).every(edit=>proof.ranges.every(range=>edit.to<range.from||edit.from>range.to));
}
