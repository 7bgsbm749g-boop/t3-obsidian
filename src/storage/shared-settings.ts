const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
import {isRecord as object} from '../shared/values';
/** Three-way leaf merge. Concurrent edits to the same leaf prefer disk;
 * arrays are atomic. Relation collections have their own merge protocols. */
export function mergeSharedSettings<T>(baseline:T,disk:T,intended:T):T {
  if(same(baseline,intended))return disk;
  if(same(baseline,disk)||same(disk,intended))return intended;
  if(object(baseline)&&object(disk)&&object(intended)){
    const merged:Record<string,unknown>={};
    for(const key of new Set([...Object.keys(baseline),...Object.keys(disk),...Object.keys(intended)])){
      const value=mergeSharedSettings((baseline)[key],(disk)[key],(intended)[key]);
      if(value!==undefined)merged[key]=value;
    }
    return merged as T;
  }
  return disk;
}
