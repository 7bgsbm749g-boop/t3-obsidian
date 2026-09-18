import {Buffer} from 'buffer';
import {endpoint,descriptor,type PairedSession,type Fetcher} from './direct';
import {proofKey,proof,thumbprint} from './dpop';
// Public client configuration shipped by T3 Code; these are not secrets.
export const CLOUD={issuer:'https://clerk.t3.codes',relay:'https://relay.t3.codes',clientId:'hzxSgY2cH10sDU2r'};
export interface CloudAccount {accessToken:string;refreshToken?:string;expiresAt:number;identity:string}
export interface DeviceLogin {deviceCode:string;userCode:string;verificationUrl:string;expiresAt:number;interval:number;nextPollAt:number}
export interface CloudMachine {environmentId:string;name:string;url:string}
export class CloudError extends Error {constructor(public code:string,public status=0){super(code==='access_denied'?'T3 sign-in was denied.':code==='expired_token'?'T3 sign-in expired. Start again.':code==='invalid_grant'?'T3 sign-in expired or was revoked. Sign in again.':`T3 Connect request failed (${code}).`);}}
async function request(url:string,options:RequestInit={},fetcher:Fetcher=fetch):Promise<any>{
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),30000);
 try{
  const r=await fetcher(url,{...options,credentials:'omit',redirect:'error',cache:'no-store',signal:ctrl.signal});
  if(Number(r.headers.get('content-length')||0)>4_000_000)throw new CloudError('response_too_large');
  const text=await r.text();if(Buffer.byteLength(text)>4_000_000)throw new CloudError('response_too_large');
  let body:any;try{body=JSON.parse(text);}catch{throw new CloudError('invalid_response',r.status);}
  if(!r.ok){const code=typeof body.error==='string'&&/^[a-z_]{1,60}$/.test(body.error)?body.error:'http_'+r.status;throw new CloudError(code,r.status);}
  return body;
 }catch(e){if(e instanceof CloudError)throw e;throw new CloudError('network_unavailable');}finally{clearTimeout(timer);}
}
const form=(data:Record<string,string>):RequestInit=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data).toString()});
function account(body:any,old?:CloudAccount):CloudAccount{
 if(typeof body.access_token!=='string'||!body.access_token||!Number.isFinite(body.expires_in)||body.expires_in<=0||String(body.token_type).toLowerCase()!=='bearer')throw new CloudError('invalid_token_response');
 let identity=old?.identity??'T3 account';
 // Display only. Identity claims are never used to authorize a request.
 try{const claims=JSON.parse(Buffer.from(body.id_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString());identity=claims.email??claims.preferred_username??identity;}catch{}
 return {accessToken:body.access_token,refreshToken:typeof body.refresh_token==='string'?body.refresh_token:old?.refreshToken,expiresAt:Date.now()+body.expires_in*1000,identity:String(identity)};
}
export async function beginLogin(fetcher?:Fetcher):Promise<DeviceLogin>{
 const d=await request(CLOUD.issuer+'/oauth/device_authorization',form({client_id:CLOUD.clientId,scope:'openid profile email offline_access'}),fetcher);
 const url=new URL(d.verification_uri_complete??d.verification_uri);
 if(url.origin!=='https://accounts.t3.codes'||url.username||url.password||typeof d.device_code!=='string'||typeof d.user_code!=='string'||!Number.isFinite(d.expires_in)||d.expires_in<=0)throw new CloudError('invalid_device_response');
 const interval=Math.max(5,Number(d.interval)||5)*1000;return {deviceCode:d.device_code,userCode:d.user_code,verificationUrl:url.href,expiresAt:Date.now()+d.expires_in*1000,interval,nextPollAt:Date.now()+interval};
}
export async function pollLogin(login:DeviceLogin,fetcher?:Fetcher):Promise<CloudAccount|null>{
 if(Date.now()>=login.expiresAt)throw new CloudError('expired_token');if(Date.now()<login.nextPollAt)return null;
 try{return account(await request(CLOUD.issuer+'/oauth/token',form({client_id:CLOUD.clientId,grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:login.deviceCode}),fetcher));}
 catch(e){if(e instanceof CloudError){if(e.code==='authorization_pending')return null;if(e.code==='slow_down'||e.code==='network_unavailable'||e.status>=500){login.interval=Math.min(login.interval+5000,60000);return null;}}throw e;}
 finally{login.nextPollAt=Date.now()+login.interval;}
}
export async function refreshAccount(current:CloudAccount,fetcher?:Fetcher):Promise<CloudAccount>{
 if(current.expiresAt>Date.now()+60000)return current;if(!current.refreshToken)throw new CloudError('invalid_grant');
 return account(await request(CLOUD.issuer+'/oauth/token',form({client_id:CLOUD.clientId,grant_type:'refresh_token',refresh_token:current.refreshToken}),fetcher),current);
}
export async function discoverMachines(a:CloudAccount,fetcher?:Fetcher):Promise<CloudMachine[]>{
 const result=await request(CLOUD.relay+'/v1/environments',{headers:{Authorization:'Bearer '+a.accessToken}},fetcher);
 if(!Array.isArray(result.environments))throw new CloudError('invalid_environment_list');
 const ids=new Set<string>();return result.environments.map((e:any)=>{if(typeof e.environmentId!=='string'||!e.environmentId||ids.has(e.environmentId)||typeof e.label!=='string')throw new CloudError('invalid_environment_list');ids.add(e.environmentId);return {environmentId:e.environmentId,name:e.label,url:endpoint(e.endpoint.httpBaseUrl)};});
}

export async function connectMachine(a:CloudAccount,m:CloudMachine,keyId:string,fetcher?:Fetcher):Promise<PairedSession>{
 const key=await proofKey(keyId);const exchange=CLOUD.relay+'/v1/client/dpop-token';
 const opts=form({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:a.accessToken,subject_token_type:'urn:ietf:params:oauth:token-type:jwt',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',resource:CLOUD.relay,scope:'environment:connect',client_id:'t3-web'});
 const t=await request(exchange,{...opts,headers:{...opts.headers,DPoP:await proof(key,'POST',exchange)}},fetcher);
 if(t.token_type!=='DPoP'||typeof t.access_token!=='string'||t.scope!=='environment:connect')throw new CloudError('invalid_relay_token');
 const url=CLOUD.relay+'/v1/environments/'+encodeURIComponent(m.environmentId)+'/connect';
 const connected=await request(url,{method:'POST',headers:{Authorization:'DPoP '+t.access_token,DPoP:await proof(key,'POST',url,t.access_token),'Content-Type':'application/json'},body:JSON.stringify({clientProofKeyThumbprint:await thumbprint(key)})},fetcher);
 if(connected.environmentId!==m.environmentId||endpoint(connected.endpoint.httpBaseUrl)!==m.url||typeof connected.credential!=='string')throw new CloudError('environment_changed');
 const d=await descriptor(m.url,fetcher);if(d.environmentId!==m.environmentId)throw new CloudError('environment_changed');
 const tokenUrl=m.url+'/oauth/token';const tokenOpts=form({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:connected.credential,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:'orchestration:read orchestration:operate',client_label:'Send to T3 Code (Obsidian)'});
 const session=await request(tokenUrl,{...tokenOpts,headers:{...tokenOpts.headers,DPoP:await proof(key,'POST',tokenUrl)}},fetcher);
 const scopes=new Set(String(session.scope).split(' '));
 if(session.token_type!=='DPoP'||typeof session.access_token!=='string'||!Number.isFinite(session.expires_in)||session.expires_in<=0||!scopes.has('orchestration:read')||!scopes.has('orchestration:operate'))throw new CloudError('invalid_environment_token');
 return {token:session.access_token,expiresAt:Date.now()+session.expires_in*1000,url:m.url,environmentId:m.environmentId,dpopKeyId:keyId};
}
