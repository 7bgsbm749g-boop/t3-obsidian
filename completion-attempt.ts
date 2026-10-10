/** A false legacy CAS result cannot establish whether disk was changed. */
export type FinalWriteOutcome={status:'no-write'|'written-unverified'|'unknown'|'verified'};
export type FinalWriteState='not-started'|'writing'|FinalWriteOutcome['status'];
export type FinalAttemptAbort={version:1;commitId:string;hash:string;proofHash:string;journalRevision:number}&(
  {writeState:'no-write'}|{writeState:'reviewed-conflict';reviewedCurrentHash:string}
);
export const MAX_SUPERSEDED_FINAL_ATTEMPTS=32;
