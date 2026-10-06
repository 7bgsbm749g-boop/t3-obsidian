import {responseAnchor,responseRegion} from './native-response-projection';

/** Preparation for an explicitly reviewed repair, never automatic resurrection.
 * Missing anchors require the exact journaled deletion preimage. Text found
 * inside intact boundaries moves outside them without losing any bytes. */
export function restoreResponseAnchor(id:string,original:string,saved:string):string {
  const current=responseRegion(saved,id),anchor=responseAnchor(id);
  if(current){
    if(saved.slice(current.from,current.to)===anchor)return saved;
    return saved.slice(0,current.from)+current.body+anchor+saved.slice(current.to);
  }
  const prior=responseRegion(original,id);
  if(!prior||original.slice(prior.from,prior.to)!==anchor)throw Error('The journal does not contain a unique original response anchor.');
  if(saved!==original.slice(0,prior.from)+original.slice(prior.to))throw Error('The note changed beyond the removed response anchor. Review its placement before recovery.');
  return original;
}
