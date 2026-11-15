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

/** Relation stores use their own union/clock protocols. Do not recursively
 * compare their large payloads in a preference merge that discards that result. */
export function mergeSharedSettingsExcept<T extends object>(baseline:T,disk:T,intended:T,keys:readonly (keyof T)[]):T {
  const omit=(value:T)=>{const preferences={...value};for(const key of keys)delete preferences[key];return preferences;};
  const excluded:Partial<T>={};for(const key of keys)if(Object.hasOwn(intended,key))excluded[key]=intended[key];
  return {...excluded,...mergeSharedSettings(omit(baseline),omit(disk),omit(intended))};
}
