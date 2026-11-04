import {CODEBASE_PREFIX} from './codebase-core';

const key=Symbol.for('t3-codebase-adapter-guard-v1');
const methods=['read','readBinary','write','writeBinary','append','exists','stat','getResourcePath','remove','rename','mkdir','trashLocal','trashSystem'];
type Handler=(method:string,path:string,args:unknown[])=>unknown;
interface Guard {handler?:Handler}
function guardedMethod(method:string,original:(path:string,...args:unknown[])=>unknown,state:Guard){
  // Keep this closure outside the installer: its lexical environment must not
  // include the active handler (and therefore the complete bridge).
  return (path:string,...args:unknown[])=>{
    if(!path.startsWith(CODEBASE_PREFIX))return original(path,...args);
    if(!state.handler)throw Error('The T3 project file bridge is stopped. Project bytes cannot be written to the vault.');
    return state.handler(method,path,args);
  };
}

/** One small guard survives plugin reloads. Its active handler is released on
 * unload; old native leaves cannot write a virtual path into the real vault. */
export function installCodebaseAdapter(adapter:object,handler:Handler):()=>void {
  let guard=Reflect.get(adapter,key) as Guard|undefined;
  if(!guard){
    guard={};Object.defineProperty(adapter,key,{value:guard});
    const state=guard;
    for(const method of methods){
      const original:unknown=Reflect.get(adapter,method);if(typeof original!=='function')continue;
      const replacement=guardedMethod(method,(path,...args)=>Reflect.apply(original,adapter,[path,...args]) as unknown,state);
      if(!Reflect.set(adapter,method,replacement))throw Error('The vault adapter cannot protect project files.');
    }
  }
  guard.handler=handler;
  return ()=>{if(guard.handler===handler)guard.handler=undefined;};
}
