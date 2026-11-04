import {installDomFactories} from './dom-factories';
import {runInNewContext as run,type Context,type RunningCodeInNewContextOptions} from 'node:vm';
/** Obsidian exposes activeDocument alongside document. Source modules can
 * therefore use its public pop-out API in the same small VM fixtures. */
export function runInNewContext(code:string,context:Context={},options?:RunningCodeInNewContextOptions){
  if(typeof context.fetch==='function'){if(!context.window)context.window={fetch:context.fetch};else if(!context.window.fetch)context.window.fetch=context.fetch;}
  if(context.document&&typeof context.document.createElement==='function')installDomFactories(context.document);
  if(!('activeDocument' in context)&&'document' in context)context.activeDocument=context.document;
  return run(code,context,options);
}
