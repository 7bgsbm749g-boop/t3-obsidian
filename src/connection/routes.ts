import type {PairedConnection} from './direct';
import {pairingInput} from './direct';

export type ConnectionMethod='connect'|'local'|'https'|'ssh';
export function loopbackAddress(address:string){return ['localhost','127.0.0.1','[::1]'].includes(new URL(address).hostname);}
export function routeMethod(route:PairedConnection):ConnectionMethod{return route.managed?'connect':route.routeKind??(loopbackAddress(route.url)?'local':'https');}
export function localRoute(route:PairedConnection){return routeMethod(route)==='local';}
export const routeNames:Record<ConnectionMethod,string>={connect:'T3 Connect',local:'This computer',https:'HTTPS / Tailscale',ssh:'SSH tunnel'};
export function routePairing(method:ConnectionMethod,address:string,code:string){
  const input=pairingInput(address,code);
  if(method==='connect')throw Error('Use T3 account sign-in to add a T3 Connect route.');
  if((method==='local'||method==='ssh')&&!loopbackAddress(input.url))throw Error(method==='local'?'Use the localhost address of T3 on this computer.':'Use the localhost address of the SSH tunnel on this device. Start the tunnel outside Obsidian first.');
  if(method==='https'&&new URL(input.url).protocol!=='https:')throw Error('Use an HTTPS address for this connection.');
  return input;
}
export function orderedRoutes(routes:readonly PairedConnection[],order:readonly string[],score:(route:PairedConnection)=>number=()=>0){
  const position=(route:PairedConnection)=>{const index=order.indexOf(route.id);return index<0?Number.MAX_SAFE_INTEGER:index;};
  return [...routes].sort((a,b)=>position(a)-position(b)||score(b)-score(a));
}
export function routeGroups(routes:readonly PairedConnection[]){
  const groups=new Map<string,{environmentId:string;name:string;routes:PairedConnection[]}>();
  for(const route of routes){const group=groups.get(route.environmentId)??{environmentId:route.environmentId,name:route.name,routes:[]};group.routes.push(route);groups.set(route.environmentId,group);}
  return [...groups.values()];
}
