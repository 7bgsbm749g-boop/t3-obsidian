import {createRequire} from 'node:module';
const hostRequire=createRequire(import.meta.url);
const hostEditor=/^(?:@codemirror|@lezer)\//;
import {installDomFactories} from './dom-factories';
import {runInNewContext as run,type Context,type RunningCodeInNewContextOptions} from 'node:vm';
/** Obsidian exposes activeDocument alongside document. Source modules can
 * therefore use its public pop-out API in the same small VM fixtures. */
export function runInNewContext(code:string,context:Context={},options?:RunningCodeInNewContextOptions){
  const sourceRequire=context.require;
  if(typeof sourceRequire==='function')context.require=(id:string)=>{
    // Editor SDK modules are portable host dependencies, not Node capabilities.
    // Keep the original strict fixture loader for every Node module.
    if(hostEditor.test(id))return hostRequire(id);
    const value=sourceRequire(id);
    if(id==='obsidian'&&value?.Platform&&typeof value.Platform.isDesktop!=='boolean')value.Platform.isDesktop=!value.Platform.isMobile;
    return value;
  };
  if(typeof context.fetch==='function'){if(!context.window)context.window={fetch:context.fetch};else if(!context.window.fetch)context.window.fetch=context.fetch;}
  if(context.document&&typeof context.document.createElement==='function')installDomFactories(context.document);
  if(!('activeDocument' in context)&&'document' in context)context.activeDocument=context.document;
  return run(code,context,options);
}
