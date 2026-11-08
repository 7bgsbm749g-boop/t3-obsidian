import {isRecord} from '../shared/values';
/** Historical fixture allowance. Live HTTP, RPC and stream reads have no
 * plugin-imposed response-size ceiling. */
export const T3_RESPONSE_MAX_BYTES=8_000_000;

export class T3ResponseTooLargeError extends Error {
  readonly name='T3ResponseTooLargeError';
  readonly kind='response_too_large';
  constructor(){super('T3 rejected an oversized response.');}
}
export function responseTooLarge(error:unknown):boolean {
  return error instanceof T3ResponseTooLargeError||isRecord(error)&&(error.kind==='response_too_large'||error.code==='response_too_large');
}
export interface StreamReadFailure {kind:'response-too-large';operation:'snapshot'|'final-reply';key?:string}
export const RESPONSE_SIZE_FAILURE='Reply not saved: T3 rejected the response size.';
/** A display-only warning. Retain all received text and the original body. */
export function failedStreamBody(body:string):string {
  const warning=`> [!failure] **${RESPONSE_SIZE_FAILURE}**\n> The oversized download has stopped.\n\n`;
  return body.startsWith(warning)?body:warning+body;
}
