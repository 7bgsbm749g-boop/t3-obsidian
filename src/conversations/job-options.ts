import type {OutgoingContext} from '../connection/send-contracts';
import type {ModelSelection} from './model-defaults';
import {finalAnswerFormat,type IntermediateMode,type FinalAnswerFormat} from '../responses/response-presentation';

/** A dialog-local draft. Missing values inherit; false is an explicit Off. */
export interface JobOverrides {interactionMode?:'default'|'plan';providerCommand?:string;context?:OutgoingContext;modelSelection?:ModelSelection;inline?:{enabled?:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat}}
export interface InlineDefaults {enabled:boolean;keepIntermediate?:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat}
export interface ResolvedJobOptions {interactionMode?:'default'|'plan';providerCommand?:string;context?:OutgoingContext;modelSelection?:ModelSelection;version:1;inline:{enabled:boolean;intermediateMode:IntermediateMode;finalAnswerFormat:FinalAnswerFormat}}
export function resolveJobOptions(defaults:InlineDefaults,draft:JobOverrides={}):ResolvedJobOptions {
  return {version:1,...(draft.interactionMode?{interactionMode:draft.interactionMode}:{}),...(draft.providerCommand?{providerCommand:draft.providerCommand}:{}),...(draft.context?{context:structuredClone(draft.context)}:{}),...(draft.modelSelection?{modelSelection:structuredClone(draft.modelSelection)}:{}),inline:{enabled:draft.inline?.enabled??defaults.enabled,intermediateMode:'collapse',finalAnswerFormat:draft.inline?.finalAnswerFormat??finalAnswerFormat(defaults.finalAnswerFormat)}};
}
export function overrideCount(draft:JobOverrides):number {
  return [draft.inline?.enabled,draft.inline?.finalAnswerFormat].filter(value=>value!==undefined).length;
}
