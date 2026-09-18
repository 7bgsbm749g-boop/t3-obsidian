import {Buffer} from 'buffer';
import {deviceState} from './device-state';
export interface ProofKey {privateKey:CryptoKey;publicJwk:JsonWebKey}
const b64=(v:ArrayBuffer|Uint8Array|string)=>Buffer.from(typeof v==='string'?new TextEncoder().encode(v):new Uint8Array(v)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const pendingKeys=new Map<string,Promise<ProofKey>>();
export async function proofKey(id:string,create=true):Promise<ProofKey>{
 const existing=pendingKeys.get(id);if(existing)return existing;
 const work=loadProofKey(id,create);pendingKeys.set(id,work);try{return await work;}finally{if(pendingKeys.get(id)===work)pendingKeys.delete(id);}
}
async function loadProofKey(id:string,create:boolean):Promise<ProofKey>{
 const name='dpop:'+id;const saved=await deviceState(name);if(saved?.privateKey&&saved?.publicJwk)return saved;
 if(!create)throw Error('This device’s connection key is missing. Refresh your T3 connections.');
 if(!crypto.subtle)throw Error('Secure browser cryptography is unavailable on this device.');
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const key={privateKey:pair.privateKey,publicJwk:await crypto.subtle.exportKey('jwk',pair.publicKey)};
 await deviceState(name,key);return key;
}
export async function thumbprint(key:ProofKey){const {crv,kty,x,y}=key.publicJwk;return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({crv,kty,x,y}))));}
export async function proof(key:ProofKey,method:string,url:string,token?:string){
 const u=new URL(url);u.search='';u.hash='';
 const header=b64(JSON.stringify({typ:'dpop+jwt',alg:'ES256',jwk:key.publicJwk}));
 const payload=b64(JSON.stringify({jti:b64(crypto.getRandomValues(new Uint8Array(16))),htm:method.toUpperCase(),htu:u.href,iat:Math.floor(Date.now()/1000),...(token?{ath:b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))}:{})}));
 const input=header+'.'+payload;const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,new TextEncoder().encode(input));return input+'.'+b64(sig);
}
