import {isRecord,parseJson} from '../shared/values';
import {Buffer} from 'buffer/';
import type {Fetcher} from './direct';
import type {CloudAccount} from './cloud';
import {SignInRequiredError} from './sign-in-state';

// Lazy SDK import keeps the explicitly injected standalone transport usable.
const defaultNativeAccountFetch:Fetcher=async(input,options)=>(await import('./network')).nativeAccountFetch(input,options);
const ORIGIN='https://clerk.t3.codes';
export interface NativeAccount {clientToken:string;sessionId:string;userId:string;identity:string}
export interface EmailLogin {clientToken:string;signInId:string;email:string;expiresAt:number}
export class SignInError extends Error {}
type ClientState={clientToken:string};
const messages:Record<string,string>={
 form_identifier_not_found:'No T3 account was found for that email. Use the email shown in your T3 account.',
 form_code_incorrect:'That verification code is incorrect. Try again.',
 verification_expired:'That verification code expired. Request a new code.',
 too_many_requests:'Too many sign-in attempts. Wait a moment before trying again.',
 session_expired:'Your T3 sign-in expired. Sign in again.',
};
async function request(path:string,state:ClientState,body:Record<string,string>|undefined,fetcher:Fetcher,changed?:()=>Promise<void>):Promise<{data:Record<string,unknown>;client:Record<string,unknown>|undefined}>{
 const url=ORIGIN+path+'?__clerk_api_version=2026-05-12&_is_native=1';
 const controller=new AbortController();
 try{
  const response=await fetcher(url,{method:body?'POST':'GET',headers:{...(state.clientToken?{Authorization:'Bearer '+state.clientToken}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:new URLSearchParams(body).toString()}:{}),credentials:'omit',redirect:'error',signal:controller.signal});
  const text=await response.text();if(Buffer.byteLength(text)>1_000_000)throw new SignInError('T3 sign-in response is too large.');
  let data:Record<string,unknown>;try{const parsed=parseJson(text);if(!isRecord(parsed))throw Error('Expected a sign-in object.');data=parsed;}catch{throw new SignInError('T3 sign-in returned an invalid response.');}
  const rotated=response.headers.get('authorization')?.replace(/^Bearer /i,'');
  if(rotated){state.clientToken=rotated;await changed?.();}
  if(!response.ok){const first=Array.isArray(data.errors)?data.errors[0] as unknown:undefined;const code=isRecord(first)&&typeof first.code==='string'?first.code:'';
   if(response.status===401||['session_expired','session_revoked','session_not_found','client_invalid','client_not_found'].includes(code))throw new SignInRequiredError();
   throw new SignInError(messages[code]??(response.status===429?messages.too_many_requests:`T3 sign-in failed (HTTP ${response.status}). Try again or use advanced pairing.`));}
  // Clerk uses null when the response does not include a separate client update.
  const result=data.response??data,client=data.client??undefined;
  if(!isRecord(result)||client!==undefined&&!isRecord(client))throw new SignInError('T3 sign-in returned an invalid response.');
  return {data:result,client};
 }catch(e){if(e instanceof SignInError||e instanceof SignInRequiredError)throw e;throw new SignInError('Cannot reach T3 sign-in. Check your internet connection.');}
}
export async function beginEmailLogin(email:string,fetcher:Fetcher=defaultNativeAccountFetch):Promise<EmailLogin>{
 email=email.trim();if(email.length>320||!/^\S+@\S+\.\S+$/.test(email))throw new SignInError('Enter the email address you use for T3.');
 const login:EmailLogin={clientToken:'',signInId:'',email,expiresAt:Date.now()+10*60_000};
 await request('/v1/client',login,undefined,fetcher);
 if(!login.clientToken)throw new SignInError('T3 did not provide a native sign-in session.');
 const started=await request('/v1/client/sign_ins',login,{identifier:email},fetcher);
 if(typeof started.data.id!=='string')throw new SignInError('T3 did not create a sign-in request.');
 login.signInId=started.data.id;
 const factor=(Array.isArray(started.data.supported_first_factors)?started.data.supported_first_factors:[]).filter(isRecord).find(f=>f.strategy==='email_code'&&typeof f.email_address_id==='string');
 if(!factor||typeof factor.email_address_id!=='string')throw new SignInError('This T3 account does not support email-code sign-in. Use advanced pairing.');
 await request('/v1/client/sign_ins/'+encodeURIComponent(login.signInId)+'/prepare_first_factor',login,{strategy:'email_code',email_address_id:factor.email_address_id},fetcher);
 return login;
}
export async function verifyEmailLogin(login:EmailLogin,code:string,fetcher:Fetcher=defaultNativeAccountFetch):Promise<NativeAccount>{
 if(Date.now()>=login.expiresAt)throw new SignInError(messages.verification_expired);
 if(!/^\d{6}$/.test(code.trim()))throw new SignInError('Enter the six-digit code from your T3 email.');
 const completed=await request('/v1/client/sign_ins/'+encodeURIComponent(login.signInId)+'/attempt_first_factor',login,{strategy:'email_code',code:code.trim()},fetcher);
 if(completed.data.status!=='complete'||typeof completed.data.created_session_id!=='string')throw new SignInError('T3 requires an additional sign-in step. Finish it in T3 or use advanced pairing.');
 const client=completed.client??(await request('/v1/client',login,undefined,fetcher)).data;
 const session=(Array.isArray(client.sessions)?client.sessions:[]).filter(isRecord).find(s=>s.id===completed.data.created_session_id&&s.status==='active');
 if(typeof session?.id!=='string'||!isRecord(session.user)||typeof session.user.id!=='string')throw new SignInError('T3 did not return an active account session.');
 return {clientToken:login.clientToken,sessionId:session.id,userId:session.user.id,identity:login.email};
}
export async function nativeRelayAccount(account:NativeAccount,changed:()=>Promise<void>,fetcher:Fetcher=defaultNativeAccountFetch):Promise<CloudAccount>{
 const client=await request('/v1/client',account,undefined,fetcher,changed);
 if(!(Array.isArray(client.data.sessions)?client.data.sessions:[]).filter(isRecord).some(s=>s.id===account.sessionId&&s.status==='active'&&isRecord(s.user)&&s.user.id===account.userId))throw new SignInRequiredError();
 const result=await request('/v1/client/sessions/'+encodeURIComponent(account.sessionId)+'/tokens/t3-relay',account,{},fetcher,changed);
 if(typeof result.data.jwt!=='string')throw new SignInError('T3 did not authorize account connections.');
 let expiresAt=0;try{const claims=parseJson(Buffer.from(result.data.jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString());if(isRecord(claims)&&typeof claims.exp==='number')expiresAt=claims.exp*1000;}catch{/* Invalid claims retain zero expiry and fail the check below. */}
 if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw new SignInError('T3 returned an expired account token.');
 return {accessToken:result.data.jwt,expiresAt,identity:account.identity};
}
export async function revokeNativeAccount(account:NativeAccount,fetcher:Fetcher=defaultNativeAccountFetch){
 await request('/v1/client/sessions/'+encodeURIComponent(account.sessionId)+'/remove',account,{},fetcher);
}
