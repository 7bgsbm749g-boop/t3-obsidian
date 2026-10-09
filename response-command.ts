import {safeNotePath} from './hosted-inline';
export const RESPONSE_COMMANDS=['resolve-response-location','response-status','response-import-info','resume-response','stage-note-edit','submit-note-edit','repair-response','remove-response','close-stream-block'] as const;
export interface CloseStreamBlockCommand {version:1;id:string;kind:'close-stream-block';foldKey:string;hash:string;notePath:string}
export type ResponseCommand=CloseStreamBlockCommand|{version:1;id:string;kind:Exclude<typeof RESPONSE_COMMANDS[number],'close-stream-block'>;bindingId:string;hash?:string;notePath?:string};
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function isResponseCommand(value:{kind:string}):value is ResponseCommand{return RESPONSE_COMMANDS.includes(value.kind as any);}
export function validateResponseCommand(value:any):ResponseCommand {
  if(value?.version!==1||!uuid(value.id)||!isResponseCommand(value))throw Error('Choose the exact response binding UUID.');
  if(value.kind==='close-stream-block'){
    if(!safeNotePath(value.notePath)||typeof value.foldKey!=='string'||value.foldKey.length>1000||!value.foldKey.endsWith(':complete')||!/^([0-9a-f]{64})$/.test(value.hash??''))throw Error('Choose the exact completed streaming block and its current checksum.');
    return value;
  }
  if(!uuid(value.bindingId))throw Error('Choose the exact response binding UUID.');
  if(['submit-note-edit','repair-response','resolve-response-location'].includes(value.kind)&&!/^([0-9a-f]{64})$/.test(value.hash??''))throw Error('A reviewed original or current note hash is required.');
  if(value.kind==='resolve-response-location'&&!safeNotePath(value.notePath))throw Error('Choose the exact intended note path.');
  return value;
}
