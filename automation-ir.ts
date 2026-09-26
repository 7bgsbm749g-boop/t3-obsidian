import {canonical,exactHash,type EventType,type NormalizedEventPayload} from './automation-protocol';

export type Truth='true'|'false'|'unknown';
export type TypedValue={type:'missing'}|{type:'null'}|{type:'string';value:string}|{type:'number';value:number}|{type:'boolean';value:boolean};
export type Predicate=
  |{op:'all';items:Predicate[]}|{op:'any';items:Predicate[]}|{op:'not';item:Predicate}
  |{op:'property.equals';property:string;phase?:'before'|'after';value:TypedValue}
  |{op:'property.transition';property:string;from?:TypedValue;to?:TypedValue}
  |{op:'tag.present';phase:'before'|'after';tag:string;includeDescendants:boolean}
  |{op:'tag.added'|'tag.removed';tag:string}
  |{op:'path.matches';phase:'before'|'after';glob:string;case:'sensitive'|'insensitive'}
  |{op:'path.enters';glob:string;case:'sensitive'|'insensitive'}
  |{op:'literal.contains';phase:'before'|'after';text:string;section?:string};
export interface WorkflowAction {id:string;type:'t3.startThread'|'vault.applyValidatedResult'|'event.emit';promptTemplate?:string;fromStep?:string;precondition?:'expected-input-hash';contractVersion?:number;historyAccess?:boolean}
export interface SequenceTrigger {key:'noteId'|'incarnationId';ordering:'coordinator';withinMs:number;steps:Array<{eventTypes:EventType[];predicate?:Predicate}>}
export interface ScheduleTrigger {kind:'weekday';weekdays:number[];localTime:string;timezone:string;catchUp:'one'|'none';repeat:'first'|'both'}
export interface WorkflowIR {
  irVersion:1;semanticsVersion:1;workflowId:string;revision:number;enabled:boolean;destinationId:string;
  name?:string;folderPath?:string;projectId?:string;connectionId?:string;activatedAt?:string;
  scope:{path:{glob:string;case:'sensitive'|'insensitive'};exclude:string[];overlapPolicy:'all-matching'};
  trigger:{eventTypes?:EventType[];predicate?:Predicate;sequence?:SequenceTrigger;schedule?:ScheduleTrigger;unknown:'hold-for-review'|'no-match'};
  timing:{debounce:{key:'noteId'|'incarnationId';quietMs:number;maxWaitMs:number;preserveTransitions:boolean}};
  execution:{input:'current-validated-revision'|'recorded-transition';requireAtStart?:Predicate[];concurrencyKey:'noteId'|'incarnationId';batchOrder:number;failurePolicy:'stop-batch';provenance:{ownWorkflowOutputs:'exclude'|'include';otherWorkflowOutputs:'exclude'|'explicit-only'|'include'}};
  actions:WorkflowAction[];
}

const id=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function validGlob(value:string){return value.length>0&&value.length<=512&&!value.includes('\\')&&!value.split('/').some(part=>part==='..');}
function validateTyped(value:TypedValue|undefined){if(!value||!['missing','null','string','number','boolean'].includes(value.type))throw Error('Invalid typed value.');if(['string','number','boolean'].includes(value.type)&&!('value'in value))throw Error('Typed value is missing its value.');}
export function validatePredicate(value:Predicate,depth=0):void{
  if(depth>16||!value||typeof value!=='object'||typeof value.op!=='string')throw Error('Invalid workflow predicate.');
  if(value.op==='all'||value.op==='any'){if(!Array.isArray(value.items)||!value.items.length||value.items.length>64)throw Error('Predicate groups require 1–64 items.');for(const item of value.items)validatePredicate(item,depth+1);return;}
  if(value.op==='not'){validatePredicate(value.item,depth+1);return;}
  if(value.op==='property.equals'){if(!value.property||value.property.length>128)throw Error('Invalid property name.');validateTyped(value.value);return;}
  if(value.op==='property.transition'){if(!value.property||(!value.from&&!value.to))throw Error('A transition needs a property and boundary.');if(value.from)validateTyped(value.from);if(value.to)validateTyped(value.to);return;}
  if(value.op==='tag.present'||value.op==='tag.added'||value.op==='tag.removed'){if(!value.tag||value.tag.length>256)throw Error('Invalid tag predicate.');return;}
  if(value.op==='path.matches'||value.op==='path.enters'){if(!validGlob(value.glob))throw Error('Invalid path glob.');return;}
  if(value.op==='literal.contains'){if(!value.text||value.text.length>4096)throw Error('Invalid literal predicate.');return;}
  throw Error(`Unknown workflow predicate operator: ${(value as {op:string}).op}`);
}
export function validateWorkflowIR(value:unknown):WorkflowIR{
  if(!value||typeof value!=='object')throw Error('Workflow release must be an object.');const ir=value as WorkflowIR;
  if(ir.irVersion!==1||ir.semanticsVersion!==1||!id.test(ir.workflowId)||!Number.isSafeInteger(ir.revision)||ir.revision<1||!id.test(ir.destinationId))throw Error('Invalid workflow release identity or version.');
  if(ir.name!==undefined&&(typeof ir.name!=='string'||!ir.name.trim()||ir.name.length>160)||ir.folderPath!==undefined&&(typeof ir.folderPath!=='string'||!ir.folderPath||ir.folderPath.includes('..')||ir.folderPath.includes('\\'))||ir.projectId!==undefined&&(typeof ir.projectId!=='string'||!ir.projectId||ir.projectId.length>256)||ir.connectionId!==undefined&&(typeof ir.connectionId!=='string'||ir.connectionId.length>256))throw Error('Invalid folder workflow destination.');
  if(ir.activatedAt!==undefined&&(typeof ir.activatedAt!=='string'||!Number.isFinite(Date.parse(ir.activatedAt))))throw Error('Invalid workflow activation time.');
  if(!ir.scope||!validGlob(ir.scope.path?.glob)||!['sensitive','insensitive'].includes(ir.scope.path.case)||ir.scope.overlapPolicy!=='all-matching'||!Array.isArray(ir.scope.exclude)||ir.scope.exclude.some(x=>!validGlob(x)))throw Error('Invalid workflow scope.');
  const validEvents=['note.created','note.changed','note.renamed','note.deleted','note.reconciled','workflow.requested','workflow.started','workflow.completed','workflow.failed','note.changeApplied'];if(!ir.trigger)throw Error('Invalid workflow trigger.');const modes=Number(Boolean(ir.trigger.eventTypes))+Number(Boolean(ir.trigger.sequence))+Number(Boolean(ir.trigger.schedule));if(modes!==1)throw Error('A workflow needs exactly one direct, sequence, or schedule trigger.');if(ir.trigger.eventTypes&&(!Array.isArray(ir.trigger.eventTypes)||!ir.trigger.eventTypes.length||ir.trigger.eventTypes.some(x=>!validEvents.includes(x))))throw Error('Invalid workflow event types.');
  if(ir.trigger.predicate)validatePredicate(ir.trigger.predicate);if(!['hold-for-review','no-match'].includes(ir.trigger.unknown))throw Error('Invalid unknown policy.');
  if(ir.trigger.sequence){const sequence=ir.trigger.sequence;if(sequence.ordering!=='coordinator'||!Number.isSafeInteger(sequence.withinMs)||sequence.withinMs<1||sequence.withinMs>604_800_000||!Array.isArray(sequence.steps)||sequence.steps.length<2||sequence.steps.length>16)throw Error('Invalid sequence trigger.');for(const step of sequence.steps){if(!Array.isArray(step.eventTypes)||!step.eventTypes.length||step.eventTypes.some(x=>!validEvents.includes(x)))throw Error('Invalid sequence step.');if(step.predicate)validatePredicate(step.predicate);}}
  if(ir.trigger.schedule){const schedule=ir.trigger.schedule;if(schedule.kind!=='weekday'||!Array.isArray(schedule.weekdays)||!schedule.weekdays.length||schedule.weekdays.some(day=>!Number.isInteger(day)||day<1||day>7)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)||!schedule.timezone||!['one','none'].includes(schedule.catchUp)||!['first','both'].includes(schedule.repeat))throw Error('Invalid schedule trigger.');try{new Intl.DateTimeFormat('en',{timeZone:schedule.timezone}).format(0);}catch{throw Error('Invalid schedule timezone.');}}
  const debounce=ir.timing?.debounce;if(!debounce||!Number.isSafeInteger(debounce.quietMs)||!Number.isSafeInteger(debounce.maxWaitMs)||debounce.quietMs<0||debounce.maxWaitMs<debounce.quietMs||debounce.maxWaitMs>86_400_000)throw Error('Invalid debounce policy.');
  if(!ir.execution||!Number.isSafeInteger(ir.execution.batchOrder)||ir.execution.failurePolicy!=='stop-batch')throw Error('Invalid execution policy.');for(const guard of ir.execution.requireAtStart??[])validatePredicate(guard);
  if(!Array.isArray(ir.actions)||!ir.actions.length||ir.actions.length>32)throw Error('A workflow needs 1–32 actions.');const actions=new Set<string>();for(const action of ir.actions){if(!id.test(action.id)||actions.has(action.id)||!['t3.startThread','vault.applyValidatedResult','event.emit'].includes(action.type))throw Error('Invalid workflow action.');actions.add(action.id);if(action.type==='t3.startThread'&&(!action.promptTemplate||action.promptTemplate.length>120_000))throw Error('T3 actions need a bounded prompt.');if(action.historyAccess!==undefined&&(typeof action.historyAccess!=='boolean'||action.type!=='t3.startThread'))throw Error('Event history access must be selected for a T3 action.');if(action.fromStep&&!actions.has(action.fromStep))throw Error('Actions may only consume an earlier step.');}
  return ir;
}
export function releaseHash(ir:WorkflowIR):string{return exactHash(canonical(validateWorkflowIR(ir)));}

function globRegex(glob:string,insensitive=false):RegExp{
  let expression='';for(let index=0;index<glob.length;index++){const char=glob[index];if(char==='*'&&glob[index+1]==='*'){index++;if(glob[index+1]==='/'){index++;expression+='(?:.*/)?';}else expression+='.*';}else if(char==='*')expression+='[^/]*';else if(char==='?')expression+='[^/]';else expression+=/[.+^${}()|[\]\\]/.test(char)?`\\${char}`:char;}
  return new RegExp(`^${expression}$`,insensitive?'i':'');
}
export function globMatches(glob:string,path:string,sensitivity:'sensitive'|'insensitive'='sensitive'){return globRegex(glob,sensitivity==='insensitive').test(path);}
const and=(values:Truth[]):Truth=>values.includes('false')?'false':values.includes('unknown')?'unknown':'true';
const or=(values:Truth[]):Truth=>values.includes('true')?'true':values.includes('unknown')?'unknown':'false';
const negate=(value:Truth):Truth=>value==='unknown'?'unknown':value==='true'?'false':'true';
const equal=(a:unknown,b:unknown):Truth=>a===undefined?'unknown':canonical(a)===canonical(b)?'true':'false';
function propertyFacts(event:NormalizedEventPayload,name:string,phase:'before'|'after'):unknown{const value=(event.facts.frontmatter as Record<string,unknown>|undefined)?.[name] as Record<string,unknown>|undefined;return value?.[phase];}
function tags(event:NormalizedEventPayload,phase:'before'|'after'):string[]|undefined{return event.facts[phase==='before'?'tagsBefore':'tagsAfter'] as string[]|undefined;}
function eventPath(event:NormalizedEventPayload,phase:'before'|'after'){return phase==='before'?event.note.pathBefore:event.note.pathAfter;}
export function evaluatePredicate(predicate:Predicate,event:NormalizedEventPayload):Truth{
  if(predicate.op==='all')return and(predicate.items.map(item=>evaluatePredicate(item,event)));if(predicate.op==='any')return or(predicate.items.map(item=>evaluatePredicate(item,event)));if(predicate.op==='not')return negate(evaluatePredicate(predicate.item,event));
  if(predicate.op==='property.equals')return equal(propertyFacts(event,predicate.property,predicate.phase??'after'),predicate.value);
  if(predicate.op==='property.transition'){const from=predicate.from?equal(propertyFacts(event,predicate.property,'before'),predicate.from):'true',to=predicate.to?equal(propertyFacts(event,predicate.property,'after'),predicate.to):'true';return and([from,to]);}
  if(predicate.op==='tag.present'){const found=tags(event,predicate.phase);if(!found)return'unknown';return found.some(tag=>tag===predicate.tag||(predicate.includeDescendants&&tag.startsWith(predicate.tag+'/')))?'true':'false';}
  if(predicate.op==='tag.added'||predicate.op==='tag.removed'){const before=tags(event,'before'),after=tags(event,'after');if(!before||!after)return'unknown';const changed=predicate.op==='tag.added'?!before.includes(predicate.tag)&&after.includes(predicate.tag):before.includes(predicate.tag)&&!after.includes(predicate.tag);return changed?'true':'false';}
  if(predicate.op==='path.matches'){const path=eventPath(event,predicate.phase);return path===null?'unknown':globMatches(predicate.glob,path,predicate.case)?'true':'false';}
  if(predicate.op==='path.enters'){const before=event.note.pathBefore,after=event.note.pathAfter;if(before===null||after===null)return'unknown';return !globMatches(predicate.glob,before,predicate.case)&&globMatches(predicate.glob,after,predicate.case)?'true':'false';}
  if(predicate.op==='literal.contains'){const content=event.facts[predicate.phase==='before'?'beforeText':'afterText'];if(typeof content!=='string')return'unknown';return content.includes(predicate.text)?'true':'false';}
  return 'unknown';
}
export function matchWorkflow(ir:WorkflowIR,event:NormalizedEventPayload):{result:Truth;reason:string}{
  validateWorkflowIR(ir);if(!ir.enabled)return {result:'false',reason:'release disabled'};if(!ir.trigger.eventTypes)return {result:'false',reason:'stateful trigger requires its matcher'};if(!ir.trigger.eventTypes.includes(event.type))return {result:'false',reason:'event type'};
  const path=event.note.pathAfter??event.note.pathBefore;if(path===null)return {result:'unknown',reason:'path unavailable'};if(!globMatches(ir.scope.path.glob,path,ir.scope.path.case)||ir.scope.exclude.some(x=>globMatches(x,path,ir.scope.path.case)))return {result:'false',reason:'scope'};
  const result=ir.trigger.predicate?evaluatePredicate(ir.trigger.predicate,event):'true';return {result:result==='unknown'&&ir.trigger.unknown==='no-match'?'false':result,reason:result==='unknown'?'required fact unavailable':'predicate'};
}
export function validateReleaseSet(releases:WorkflowIR[]):void{for(const release of releases)validateWorkflowIR(release);for(let left=0;left<releases.length;left++)for(let right=left+1;right<releases.length;right++){const a=releases[left],b=releases[right],modifies=(ir:WorkflowIR)=>ir.actions.some(action=>action.type==='vault.applyValidatedResult');if(a.enabled&&b.enabled&&a.destinationId!==b.destinationId&&modifies(a)&&modifies(b)&&scopesMayOverlap(a.scope.path.glob,b.scope.path.glob))throw Error(`Modifying workflows ${a.workflowId} and ${b.workflowId} may overlap across destinations.`);}}
function scopesMayOverlap(a:string,b:string){const prefix=(glob:string)=>glob.split(/[*?]/,1)[0];const x=prefix(a),y=prefix(b);return x.startsWith(y)||y.startsWith(x);}
