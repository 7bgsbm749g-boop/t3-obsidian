/** Values crossing JSON, storage and platform boundaries start as unknown. */
export function isRecord(value:unknown):value is Record<string,unknown>{
  return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

export function errorCode(value:unknown):string|undefined{
  return isRecord(value)&&typeof value.code==='string'?value.code:undefined;
}

/** Preserve typed errors and cancellation identities; contain arbitrary throws. */
export function toError(value:unknown,fallback='Unknown error'):Error{
  if(value instanceof Error)return value;
  const detail=typeof value==='string'?value:isRecord(value)&&typeof value.message==='string'?value.message:fallback;
  const error=new Error(detail,{cause:value});
  if(isRecord(value)&&typeof value.name==='string')error.name=value.name;
  return error;
}

export function parseJson(text:string):unknown{return JSON.parse(text) as unknown;}

/** Reject ASCII controls without embedding control codes in a regular expression. */
export function hasControlCharacters(text:string,includeDelete=false):boolean{
  for(const character of text){const code=character.charCodeAt(0);if(code<32||includeDelete&&code===127)return true;}
  return false;
}

export function replaceControlCharacters(text:string,includeDelete=false):string{
  let result='';
  for(const character of text){const code=character.charCodeAt(0);result+=code<32||includeDelete&&code===127?' ':character;}
  return result;
}

export function entries(value:unknown):Array<[string,unknown]>{return isRecord(value)?Object.entries(value):[];}
export function records(value:unknown):Record<string,unknown>[]{return Array.isArray(value)?value.filter(isRecord):[];}
/** Private host adapters retain their receiver and expose an unknown result. */
export function callMember(owner:Record<string,unknown>,name:string,...args:unknown[]):unknown{
  const member=owner[name];if(typeof member!=='function')throw Error(`Host method ${name} is unavailable.`);
  return Reflect.apply(member,owner,args) as unknown;
}

/** Match the existing persisted JSON representation while retaining its type. */
export function jsonClone<T>(value:T):T{return parseJson(JSON.stringify(value)) as T;}

export function optionalString(value:unknown):string|undefined{return typeof value==='string'?value:undefined;}
export function parseJsonRecord(text:string):Record<string,unknown>{
  const value=parseJson(text);if(!isRecord(value))throw Error('Expected a JSON object.');return value;
}
/** Provider detail fields are arbitrary JSON; show useful text for objects too. */
export function valueText(value:unknown):string{
  if(value==null)return '';if(typeof value==='string')return value;
  if(typeof value==='object')return JSON.stringify(value);if(typeof value==='number'||typeof value==='boolean'||typeof value==='bigint'||typeof value==='symbol')return String(value);return '[unsupported value]';
}
