import type {ThreadAccess} from '../conversations/thread-stream';
import type {PairedConnection} from './direct';
import {toError} from '../shared/values';
import {connectionDeadline} from './connection-setup';
import {requestAborted} from './t3-api';

export interface EnvironmentAccessIO {
  /** A bounded, public loopback identity check. It issues no credential. */
  local?:{identify(signal:AbortSignal):Promise<string|undefined>;open(signal:AbortSignal):Promise<ThreadAccess>};
  /** Preferred endpoints first; all candidates must identify the same machine. */
  paired:readonly PairedConnection[];
  openPaired(connection:PairedConnection,signal:AbortSignal):Promise<ThreadAccess>;
}

/** Environment identity selects the machine; a saved pairing is only one
 * route to it. Establish access before exposing any operation to a caller.
 * Never retry a caller's read or mutation through another route here. */
export async function environmentAccess(environmentId:string,io:EnvironmentAccessIO,signal?:AbortSignal):Promise<ThreadAccess>{
  requestAborted(signal);
  const paired=io.paired.filter(connection=>connection.environmentId===environmentId);
  let localId:string|undefined;
  let failure:unknown;
  try{if(io.local)localId=await connectionDeadline(setup=>io.local!.identify(setup),signal);}catch{requestAborted(signal);/* A stopped local server cannot prevent paired access. */}
  if(localId===environmentId&&io.local){
    try{return await connectionDeadline(setup=>io.local!.open(setup),signal);}catch(error){requestAborted(signal);failure=error;}
  }
  for(const connection of paired){
    try{return await connectionDeadline(setup=>io.openPaired(connection,setup),signal);}catch(error){requestAborted(signal);failure??=error;}
  }
  if(failure!==undefined)throw toError(failure);
  throw Error('Connect this device to the thread machine to take over responses.');
}
