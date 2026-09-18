import {Buffer} from 'buffer';
import type {Fetcher} from './direct';
import type {CloudAccount} from './cloud';

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
async function request(path:string,state:ClientState,body:Record<string,string>|undefined,fetcher:Fetcher,changed?:()=>Promise<void>){
 const url=ORIGIN+path+'?__clerk_api_version=2026-05-12&_is_native=1';
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const response=await Promise.race([fetcher(url,{method:body?'POST':'GET',headers:{...(state.clientToken?{Authorization:'Bearer '+state.clientToken}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:new URLSearchParams(body).toString()}:{}),credentials:'omit',redirect:'error',signal:controller.signal}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new SignInError('T3 sign-in timed out. Try again.'));},30000);})]);
  const text=await response.text();if(Buffer.byteLength(text)>1_000_000)throw new SignInError('T3 sign-in response is too large.');
  let data:any;try{data=JSON.parse(text);}catch{throw new SignInError('T3 sign-in returned an invalid response.');}
  const rotated=response.headers.get('authorization')?.replace(/^Bearer /i,'');
  if(rotated){state.clientToken=rotated;await changed?.();}
  if(!response.ok){const code=data.errors?.[0]?.code;throw new SignInError(messages[code]??(response.status===429?messages.too_many_requests:`T3 sign-in failed (HTTP ${response.status}). Try again or use advanced pairing.`));}
  return {data:data.response??data,client:data.client};
 }catch(e){if(e instanceof SignInError)throw e;throw new SignInError('Cannot reach T3 sign-in. Check your internet connection.');}finally{clearTimeout(timer);}
}
export async function beginEmailLogin(email:string,fetcher:Fetcher=fetch):Promise<EmailLogin>{
 email=email.trim();if(email.length>320||!/^\S+@\S+\.\S+$/.test(email))throw new SignInError('Enter the email address you use for T3.');
 const login:EmailLogin={clientToken:'',signInId:'',email,expiresAt:Date.now()+10*60_000};
 await request('/v1/client',login,undefined,fetcher);
 if(!login.clientToken)throw new SignInError('T3 did not provide a native sign-in session.');
 const started=await request('/v1/client/sign_ins',login,{identifier:email},fetcher);
 if(typeof started.data.id!=='string')throw new SignInError('T3 did not create a sign-in request.');
 login.signInId=started.data.id;
 const factor=started.data.supported_first_factors?.find((f:any)=>f.strategy==='email_code'&&typeof f.email_address_id==='string');
 if(!factor)throw new SignInError('This T3 account does not support email-code sign-in. Use advanced pairing.');
 await request('/v1/client/sign_ins/'+encodeURIComponent(login.signInId)+'/prepare_first_factor',login,{strategy:'email_code',email_address_id:factor.email_address_id},fetcher);
 return login;
}
export async function verifyEmailLogin(login:EmailLogin,code:string,fetcher:Fetcher=fetch):Promise<NativeAccount>{
 if(Date.now()>=login.expiresAt)throw new SignInError(messages.verification_expired);
 if(!/^\d{6}$/.test(code.trim()))throw new SignInError('Enter the six-digit code from your T3 email.');
 const completed=await request('/v1/client/sign_ins/'+encodeURIComponent(login.signInId)+'/attempt_first_factor',login,{strategy:'email_code',code:code.trim()},fetcher);
 if(completed.data.status!=='complete'||typeof completed.data.created_session_id!=='string')throw new SignInError('T3 requires an additional sign-in step. Finish it in T3 or use advanced pairing.');
 const client=completed.client??(await request('/v1/client',login,undefined,fetcher)).data;
 const session=client.sessions?.find((s:any)=>s.id===completed.data.created_session_id&&s.status==='active');
 if(typeof session?.user?.id!=='string')throw new SignInError('T3 did not return an active account session.');
 return {clientToken:login.clientToken,sessionId:session.id,userId:session.user.id,identity:login.email};
}
export async function nativeRelayAccount(account:NativeAccount,changed:()=>Promise<void>,fetcher:Fetcher=fetch):Promise<CloudAccount>{
 const client=await request('/v1/client',account,undefined,fetcher,changed);
 if(!client.data.sessions?.some((s:any)=>s.id===account.sessionId&&s.status==='active'&&s.user?.id===account.userId))throw new SignInError(messages.session_expired);
 const result=await request('/v1/client/sessions/'+encodeURIComponent(account.sessionId)+'/tokens/t3-relay',account,{},fetcher,changed);
 if(typeof result.data.jwt!=='string')throw new SignInError('T3 did not authorize account connections.');
 let expiresAt=0;try{expiresAt=JSON.parse(Buffer.from(result.data.jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString()).exp*1000;}catch{}
 if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw new SignInError('T3 returned an expired account token.');
 return {accessToken:result.data.jwt,expiresAt,identity:account.identity};
}
export async function revokeNativeAccount(account:NativeAccount,fetcher:Fetcher=fetch){
 await request('/v1/client/sessions/'+encodeURIComponent(account.sessionId)+'/remove',account,{},fetcher);
}
