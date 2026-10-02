import {contentHash} from './completion';
import {responseAnchor,responseRegion} from './native-response-projection';
import type {LeaseRecord} from './inline-lease';
import {terminalLease} from './inline-lease';

export type NativeMigrationPlan={kind:'retain-legacy';reason:string}|{
  kind:'planned';id:string;notePath:string;before:string;after:string;
  /** Exact lease, run bindings, incoming author metadata and cleanup evidence
   * must survive migration. This is a plan, never an ownership transfer. */
  legacy:LeaseRecord;localBody:string;
};
/** Pure preparation only. No ownership grants, active note blocks, Ready
 * registrations or data.json are changed by this function. */
export function planNativeMigration(record:LeaseRecord,saved:string):NativeMigrationPlan {
  if(terminalLease(record)||record.state?.finalSaved)return {kind:'retain-legacy',reason:'Completed materialization and cleanup remain with the existing writer.'};
  if(!record.state||!['running','waiting'].includes(record.state.status))return {kind:'retain-legacy',reason:'Missing, paused or conflicting state requires existing recovery.'};
  let region:ReturnType<typeof responseRegion>;
  try{region=responseRegion(saved,record.request.id);}catch{return {kind:'retain-legacy',reason:'Ambiguous saved boundaries.'};}
  if(!region)return {kind:'retain-legacy',reason:'The exact response anchor is missing.'};
  const localBody=region.body.replace(/^\n/,'').replace(/\n$/,'');
  if(![record.request.initialHash,...record.state.hashes].includes(contentHash(localBody)))return {kind:'retain-legacy',reason:'Saved response is not a known checkpoint.'};
  return {kind:'planned',id:record.request.id,notePath:record.state.notePath,before:saved,after:saved.slice(0,region.from)+responseAnchor(record.request.id)+saved.slice(region.to),legacy:structuredClone(record),localBody};
}
