export interface TimingSample {operation:string;milliseconds:number}
export interface TimingSummary {samples:number;medianMs:number;p95Ms:number;maxMs:number}
/** Fixed operation names and numeric durations only; never export scope data. */
export function timingSummaries(values:TimingSample[],operations:readonly string[],limit=100):Record<string,TimingSummary>{
  return Object.fromEntries(operations.map(operation=>{
    const times=values.filter(value=>value.operation===operation&&Number.isFinite(value.milliseconds)&&value.milliseconds>=0).slice(-limit).map(value=>value.milliseconds).sort((a,b)=>a-b);
    const percentile=(fraction:number)=>times[Math.max(0,Math.ceil(times.length*fraction)-1)]??0;
    return [operation,{samples:times.length,medianMs:percentile(.5),p95Ms:percentile(.95),maxMs:times.at(-1)??0}];
  }));
}
