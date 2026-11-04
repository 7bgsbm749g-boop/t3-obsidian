export interface RecoveryCommand {version:1;id:string;kind:'response-recovery-info'|'retry-response-save';bindingId:string;hash?:string}
export interface RecoveryInfo {id:string;notePath:string;currentHash:string;proofHash:string;proposedHash:string;proposedCharacters:number}
export interface RecoveryCommandResult {id:string;ok:boolean;recovery?:RecoveryInfo;status?:string}
export function isRecoveryCommand(value:{kind?:string}):value is RecoveryCommand{return value.kind==='response-recovery-info'||value.kind==='retry-response-save';}
export function validateRecoveryCommand(value:any):RecoveryCommand {
  const uuid=(id:unknown)=>typeof id==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  if(value?.version!==1||!uuid(value.id)||!uuid(value.bindingId)||!isRecoveryCommand(value))throw Error('Choose the exact device response binding.');
  if(value.kind==='retry-response-save'&&!/^[0-9a-f]{64}$/.test(value.hash??''))throw Error('Review the current response recovery hash before retrying its save.');
  return value;
}
