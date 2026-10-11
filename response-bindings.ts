import type {EventTarget} from './event-subscriptions';
import type {LeaseFiles,LeaseRecord} from './inline-lease';
import {responseBinding} from './completed-lease-index';

export type ResponseBinding={id:string;path:string;messageIds:string[];turnIds:string[]};

/** Return routing identities only. Reply bodies and checkpoint history stay
 * in the host's existing verified snapshots, outside subscription state. */
export async function readResponseBindings(files:LeaseFiles,directory:string,target:EventTarget,readRecord?: (path:string)=>Promise<LeaseRecord|undefined>):Promise<ResponseBinding[]>{
  const result:ResponseBinding[]=[];
  for(const path of await files.list(`${directory}/leases`)){
    const record=readRecord?await readRecord(path):await files.read(path).then(raw=>raw?JSON.parse(raw) as LeaseRecord:undefined);
    if(!record||record.request.threadId!==target.threadId||record.request.projectId!==target.projectId||record.request.threadEnvironmentId!==target.environmentId)continue;
    result.push(responseBinding(record));
  }
  return result;
}
