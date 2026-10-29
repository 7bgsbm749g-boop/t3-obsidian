import {CODEBASE_PREFIX} from './codebase-core';

const key=Symbol.for('t3-codebase-adapter-guard-v1');
const methods=['read','readBinary','write','writeBinary','append','exists','stat','getResourcePath','remove','rename','mkdir','trashLocal','trashSystem'];
type Handler=(method:string,path:string,args:any[])=>any;
interface Guard {handler?:Handler}
function guardedMethod(method:string,original:(...args:any[])=>any,state:Guard){
  // Keep this closure outside the installer: its lexical environment must not
  // include the active handler (and therefore the complete bridge).
  return (path:string,...args:any[])=>{
    if(!path.startsWith(CODEBASE_PREFIX))return original(path,...args);
    if(!state.handler)throw Error('The T3 project file bridge is stopped. Project bytes cannot be written to the vault.');
    return state.handler(method,path,args);
  };
}

/** One small guard survives plugin reloads. Its active handler is released on
 * unload; old native leaves cannot write a virtual path into the real vault. */
export function installCodebaseAdapter(adapter:any,handler:Handler):()=>void {
  let guard=adapter[key] as Guard|undefined;
  if(!guard){
    guard={};Object.defineProperty(adapter,key,{value:guard});
    const state=guard;
    for(const method of methods){
      if(typeof adapter[method]!=='function')continue;
      adapter[method]=guardedMethod(method,adapter[method].bind(adapter),state);
    }
  }
  guard.handler=handler;
  return ()=>{if(guard!.handler===handler)guard!.handler=undefined;};
}
