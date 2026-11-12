import type {ModelSelection} from './model-defaults';
import {finalAnswerFormat,type IntermediateMode,type FinalAnswerFormat} from '../responses/response-presentation';

/** A dialog-local draft. Missing values inherit; false is an explicit Off. */
export interface JobOverrides {modelSelection?:ModelSelection;inline?:{enabled?:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat}}
export interface InlineDefaults {enabled:boolean;keepIntermediate?:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat}
export interface ResolvedJobOptions {version:1;modelSelection?:ModelSelection;inline:{enabled:boolean;intermediateMode:IntermediateMode;finalAnswerFormat:FinalAnswerFormat}}
export function resolveJobOptions(defaults:InlineDefaults,draft:JobOverrides={}):ResolvedJobOptions {
  return {version:1,...(draft.modelSelection?{modelSelection:{...draft.modelSelection,...(draft.modelSelection.options?{options:draft.modelSelection.options.map(option=>({...option}))}:{})}}:{}),inline:{enabled:draft.inline?.enabled??defaults.enabled,intermediateMode:'collapse',finalAnswerFormat:draft.inline?.finalAnswerFormat??finalAnswerFormat(defaults.finalAnswerFormat)}};
}
export function overrideCount(draft:JobOverrides):number {
  return [draft.inline?.enabled,draft.inline?.finalAnswerFormat].filter(value=>value!==undefined).length;
}
