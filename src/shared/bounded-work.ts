/** Limit independent connection setup without serializing unrelated machines. */
export async function forEachBounded<T>(values:readonly T[],limit:number,action:(value:T)=>Promise<void>):Promise<void>{
  if(!Number.isInteger(limit)||limit<1||limit>32)throw Error('Invalid connection concurrency limit.');
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{for(;;){const index=cursor++;if(index>=values.length)return;await action(values[index]);}}));
}
