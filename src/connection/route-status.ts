export interface RouteConnection {readonly closed:boolean;readonly error?:Error}

/** Observe existing transports. Status never opens a connection or replays work. */
export class RouteStatus {
  private connections=new Map<string,Set<RouteConnection>>();
  private requests=new Map<string,number>();
  private failures=new Map<string,string>();
  track(id:string,connection:RouteConnection){
    const entries=this.connections.get(id)??new Set<RouteConnection>();
    for(const entry of entries)if(entry.closed)entries.delete(entry);
    if(entries.size<128)entries.add(connection);
    this.connections.set(id,entries);
    this.failures.delete(id);
  }
  async request<T>(id:string,action:()=>Promise<T>):Promise<T>{
    this.requests.set(id,(this.requests.get(id)??0)+1);
    try{return await action();}finally{const remaining=(this.requests.get(id)??1)-1;if(remaining)this.requests.set(id,remaining);else this.requests.delete(id);}
  }
  active(id:string){
    const entries=this.connections.get(id);
    if(entries){for(const entry of entries)if(entry.closed){if(entry.error)this.failures.set(id,entry.error.message);entries.delete(entry);}if(!entries.size)this.connections.delete(id);}
    return !!entries?.size;
  }
  pending(id:string){return (this.requests.get(id)??0)>0;}
  failure(id:string){return this.failures.get(id);}
  retain(ids:readonly string[]){const allowed=new Set(ids);for(const map of [this.connections,this.failures])for(const id of map.keys())if(!allowed.has(id))map.delete(id);}
  clear(){this.connections.clear();this.requests.clear();this.failures.clear();}
}
