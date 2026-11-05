import type {ThreadAccess} from '../conversations/thread-stream';
import type {PairedConnection} from './direct';
import {toError} from '../shared/values';

export interface EnvironmentAccessIO {
  /** A bounded, public loopback identity check. It issues no credential. */
  local?:{identify():Promise<string|undefined>;open():Promise<ThreadAccess>};
  /** Preferred endpoints first; all candidates must identify the same machine. */
  paired:readonly PairedConnection[];
  openPaired(connection:PairedConnection):Promise<ThreadAccess>;
}

/** Environment identity selects the machine; a saved pairing is only one
 * route to it. Establish access before exposing any operation to a caller.
 * Never retry a caller's read or mutation through another route here. */
export async function environmentAccess(environmentId:string,io:EnvironmentAccessIO):Promise<ThreadAccess>{
  const paired=io.paired.filter(connection=>connection.environmentId===environmentId);
  let localId:string|undefined;
  let failure:unknown;
  try{localId=await io.local?.identify();}catch{/* A stopped local server cannot prevent paired access. */}
  if(localId===environmentId&&io.local){
    try{return await io.local.open();}catch(error){failure=error;}
  }
  for(const connection of paired){
    try{return await io.openPaired(connection);}catch(error){failure??=error;}
  }
  if(failure!==undefined)throw toError(failure);
  throw Error('Connect this device to the thread machine to take over responses.');
}
