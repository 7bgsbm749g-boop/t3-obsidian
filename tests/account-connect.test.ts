import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {webcrypto,createHash} from 'node:crypto';
import {proofKey,proof,thumbprint} from '../dpop';
import {connectMachine} from '../cloud';
import {readDirect} from '../direct';
import {PLUGIN_PERMISSIONS,PLUGIN_SCOPE} from '../environment-permissions';
globalThis.indexedDB=indexedDB;
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const response=(d:any)=>new Response(JSON.stringify(d));
const decode=(s:string)=>JSON.parse(Buffer.from(s,'base64url').toString());

test('DPoP keys survive storage, cannot export private material, and bind proof to URL/method/token',async()=>{
 const key=await proofKey('test');assert.equal(key.privateKey.extractable,false);
 await assert.rejects(crypto.subtle.exportKey('jwk',key.privateKey));
 assert.equal(await thumbprint(await proofKey('test',false)),await thumbprint(key));
 await assert.rejects(proofKey('missing',false),/missing/);
 const jwt=await proof(key,'get','https://t3.example/api/read?turnLimit=10','env-secret');const [h,p,s]=jwt.split('.');const header=decode(h),claims=decode(p);
 assert.equal(header.typ,'dpop+jwt');assert.equal(header.jwk.d,undefined);assert.equal(claims.htm,'GET');assert.equal(claims.htu,'https://t3.example/api/read');assert.equal(claims.ath,createHash('sha256').update('env-secret').digest('base64url'));
 const pub=await crypto.subtle.importKey('jwk',header.jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);assert.ok(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,Buffer.from(s,'base64url'),Buffer.from(h+'.'+p)));
 assert.notEqual(decode((await proof(key,'GET',claims.htu)).split('.')[1]).jti,claims.jti);
});

test('account connects without pairing codes and uses scoped DPoP for subsequent orchestration',async()=>{
 const m={environmentId:'env',name:'Computer',url:'https://t3.example'};const a={accessToken:'clerk-relay-jwt',expiresAt:Date.now()+60000,identity:'Account'};let calls=0;
 const mock=async(url:any,o:any)=>{
  calls++;assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');
  if(url.endsWith('/dpop-token')){const f=new URLSearchParams(o.body);assert.equal(f.get('subject_token'),a.accessToken);assert.equal(f.get('scope'),'environment:connect');assert.ok(o.headers.DPoP);return response({token_type:'DPoP',access_token:'relay-secret',scope:'environment:connect'});}
  if(url.endsWith('/connect')){assert.equal(o.headers.Authorization,'DPoP relay-secret');assert.equal(JSON.parse(o.body).clientProofKeyThumbprint,await thumbprint(await proofKey('connect')));return response({environmentId:'env',endpoint:{httpBaseUrl:m.url},credential:'bootstrap-secret'});}
  if(url.endsWith('/environment')){assert.equal(o.headers?.Authorization,undefined);return response({environmentId:'env',label:'Computer',orchestrationProtocolVersion:2});}
  if(url.endsWith('/oauth/token')){const f=new URLSearchParams(o.body);assert.equal(f.get('subject_token'),'bootstrap-secret');assert.equal(f.get('scope'),PLUGIN_SCOPE);assert.ok(o.headers.DPoP);return response({token_type:'DPoP',access_token:'env-secret',expires_in:600,scope:PLUGIN_SCOPE});}
  assert.equal(o.headers.Authorization,'DPoP env-secret');assert.ok(o.headers.DPoP);return response({projects:[]});
 };
 const s=await connectMachine(a,m,'connect',mock as any);assert.equal(s.dpopKeyId,'connect');assert.deepEqual(s.permissions,PLUGIN_PERMISSIONS);
 assert.deepEqual(await readDirect({transport:'direct',url:m.url,environmentId:'env',host:'direct',executable:''},['projects'],s,mock as any),{projects:[]});assert.equal(calls,6);
 let environmentCalled=false;
 await assert.rejects(connectMachine(a,m,'connect',(async(url:any,o:any)=>{if(url.startsWith(m.url))environmentCalled=true;if(url.endsWith('/connect'))return response({environmentId:'wrong',endpoint:{httpBaseUrl:m.url},credential:'secret'});return mock(url,o);}) as any),/environment_changed/);assert.equal(environmentCalled,false);
});

for(const missing of ['filesystem:read','filesystem:write'])test(`account connection refuses a token without ${missing}`,async()=>{
 const mock=async(url:any)=>{
  if(url.endsWith('/dpop-token'))return response({token_type:'DPoP',access_token:'relay',scope:'environment:connect'});
  if(url.endsWith('/connect'))return response({environmentId:'env',endpoint:{httpBaseUrl:'https://t3.example'},credential:'bootstrap'});
  if(url.endsWith('/environment'))return response({environmentId:'env',label:'Computer',orchestrationProtocolVersion:2});
  assert.ok(url.endsWith('/oauth/token'));
  return response({token_type:'DPoP',access_token:'partial-grant',expires_in:600,scope:PLUGIN_PERMISSIONS.filter(p=>p!==missing).join(' ')});
 };
 await assert.rejects(connectMachine({accessToken:'account',expiresAt:Date.now()+60000,identity:'Account'},{environmentId:'env',name:'Computer',url:'https://t3.example'},'connect',mock as any),(error:any)=>error.code==='environment_note_access_required');
});
