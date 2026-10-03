const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const object=(value:any):boolean=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Three-way leaf merge. Concurrent edits to the same leaf prefer disk;
 * arrays are atomic. Relation collections have their own merge protocols. */
export function mergeSharedSettings<T>(baseline:T,disk:T,intended:T):T {
  if(same(baseline,intended))return disk;
  if(same(baseline,disk)||same(disk,intended))return intended;
  if(object(baseline)&&object(disk)&&object(intended)){
    const merged:any={};
    for(const key of new Set([...Object.keys(baseline as any),...Object.keys(disk as any),...Object.keys(intended as any)])){
      const value=mergeSharedSettings((baseline as any)[key],(disk as any)[key],(intended as any)[key]);
      if(value!==undefined)merged[key]=value;
    }
    return merged;
  }
  return disk;
}
