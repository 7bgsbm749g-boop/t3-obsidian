import {safeNotePath} from './response-model';
import {isLogPath} from './synced-event-logs';

export type EventAction =
  | {kind:'move-note';folder:string;notePath?:string}
  | {kind:'set-property';property:string;value:unknown;notePath?:string};
export interface ActionPlan {version:1;kind:EventAction['kind'];path:string;destination?:string;before:string;after:string}
export interface ActionIO {
  read(path:string):Promise<string|undefined>;
  write(path:string,expected:string,content:string):Promise<void>;
  move(path:string,destination:string,expected:string):Promise<void>;
  parse(text:string):unknown;stringify(value:unknown):string;
}
export class EventActionSkipped extends Error {}
function frontmatter(text:string){const match=/^(?:\uFEFF)?---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(text);return match?.index===0?match:null;}
function notePath(path:unknown):path is string{return typeof path==='string'&&safeNotePath(path)&&!isLogPath(path)&&!path.startsWith('T3 Code Logs');}
export function validateEventAction(value:any):EventAction {
  if(!value||!['move-note','set-property'].includes(value.kind))throw Error('Choose a move-note or set-property action.');
  const keys=value.kind==='move-note'?['kind','folder','notePath']:['kind','property','value','notePath'];
  if(Object.keys(value).some(key=>!keys.includes(key)))throw Error('Unknown action option.');
  if(value.notePath!==undefined&&!notePath(value.notePath))throw Error('Action notePath must be a vault-relative Markdown note.');
  if(value.kind==='move-note'){
    if(typeof value.folder!=='string'||!notePath(value.folder==='/'?'action.md':value.folder+'/action.md'))throw Error('Action folder must be a vault-relative folder (or /).');
  }else{
    if(typeof value.property!=='string'||!value.property.length||value.property.length>100||/[\x00-\x1f]/.test(value.property)||['__proto__','constructor','prototype'].includes(value.property))throw Error('Invalid action property name.');
    const json=JSON.stringify(value.value);
    if(json===undefined||json.length>4096||JSON.parse(json)===undefined)throw Error('Action value must be a JSON value of at most 4096 bytes.');
  }
  return JSON.parse(JSON.stringify(value));
}
export async function prepareEventAction(action:EventAction,observedPath:string|undefined,io:ActionIO,transition?:{property:string;after:unknown;matches?:(value:unknown)=>boolean}):Promise<ActionPlan>{
  validateEventAction(action);
  if(transition&&observedPath){
    const observed=await io.read(observedPath);if(observed===undefined)throw new EventActionSkipped('Observed note no longer exists.');
    const front=frontmatter(observed);
    const properties=front?io.parse(front[1]):{};
    if(!properties||typeof properties!=='object'||!(transition.matches?transition.matches((properties as Record<string,unknown>)[transition.property]):JSON.stringify((properties as Record<string,unknown>)[transition.property])===JSON.stringify(transition.after)))throw new EventActionSkipped('Observed property has changed again; action skipped.');
  }
  const path=action.notePath??observedPath;if(!notePath(path))throw Error('This action needs an existing Markdown note; job actions require notePath.');
  const before=await io.read(path);if(before===undefined)throw Error(`Action note is unavailable: ${path}`);
  if(action.kind==='move-note'){
    const destination=(action.folder==='/'?'':action.folder+'/')+path.split('/').at(-1)!;
    if(destination!==path&&await io.read(destination)!==undefined)throw Error(`Action destination already exists: ${destination}`);
    return {version:1,kind:action.kind,path,destination,before,after:before};
  }
  const match=frontmatter(before);
  if(!match&&/^(?:\uFEFF)?---\r?\n/.test(before))throw Error('Action note has unterminated frontmatter.');
  const properties=match&&match[1].trim()?io.parse(match[1]):{};
  if(!properties||typeof properties!=='object'||Array.isArray(properties))throw Error('Action note has invalid frontmatter.');
  const values=properties as Record<string,unknown>;
  if(JSON.stringify(values[action.property])===JSON.stringify(action.value))return {version:1,kind:action.kind,path,before,after:before};
  const after='---\n'+io.stringify({...values,[action.property]:action.value}).trimEnd()+'\n---\n'+(match?before.slice(match[0].length):before);
  return {version:1,kind:action.kind,path,before,after};
}
/** Exact output recognition makes local actions safe to replay after a lost save. */
export async function executeEventAction(plan:ActionPlan,io:ActionIO):Promise<void>{
  const current=await io.read(plan.path);
  if(plan.kind==='move-note'){
    if(plan.destination===plan.path){if(current!==plan.before)throw Error('Action note changed after preparation.');return;}
    const destination=await io.read(plan.destination!);
    if(current===undefined&&destination===plan.after)return;
    if(current!==plan.before)throw Error('Action note changed after preparation.');
    if(destination!==undefined)throw Error('Action destination already exists.');
    await io.move(plan.path,plan.destination!,plan.before);
    if(await io.read(plan.path)!==undefined||await io.read(plan.destination!)!==plan.after)throw Error('Action move could not be verified.');
  }else{
    if(current===plan.after)return;
    if(current!==plan.before)throw Error('Action note changed after preparation.');
    await io.write(plan.path,plan.before,plan.after);
    if(await io.read(plan.path)!==plan.after)throw Error('Action property update could not be verified.');
  }
}
