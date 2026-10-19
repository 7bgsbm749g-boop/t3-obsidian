/** Device-local authentication state. Never put credentials or account identity
 * in a response body or a synced routing record. */
export const REAUTHENTICATE_MESSAGE='Your T3 sign-in expired. Refresh authentication on this device. Each client must sign in separately.';
export class SignInRequiredError extends Error {
  readonly name='SignInRequiredError';
  readonly signInRequired=true;
  constructor(message=REAUTHENTICATE_MESSAGE){super(message);}
}
export function signInRequired(error:unknown):boolean{return (error as {signInRequired?:unknown}|null)?.signInRequired===true;}
export interface ResponseConnectionIssue {kind:'sign-in-required'|'reconnecting'}
export function responseConnectionBody(body:string,issue:ResponseConnectionIssue,id?:string):string {
  // Only replace the generated status line, never assistant prose or tool output.
  const status=issue.kind==='sign-in-required'?'Sign in required':'Reconnecting';
  const identified=id&&!/^> \[!t3-progress\][+-] [^\n]*data-t3-fold=/m.test(body)?body.replace(/^(> \[!t3-progress\][+-] [^\n]*)/m,`$1 <span class="send-to-t3-fold-key" data-t3-fold="${encodeURIComponent(id)}:connection:active"></span>`):body;
  return identified.replace(/^((?:> \[!t3-progress\][+-] )?\*\*[^\n]* · )(?:Working|Reconnecting)(\*\*)/m,(_all,prefix,end)=>`${prefix}${status}${end}`)
    .replace(/ <span class="send-to-t3-inline-spinner" aria-label="Loading"><\/span>/g,'')
    .replace(/data-t3-tool-icon="brain" aria-hidden="true"><\/span><span>Thinking<\/span>/g,`data-t3-tool-icon="${issue.kind==='sign-in-required'?'log-in':'refresh-cw'}" aria-hidden="true"></span><span>${issue.kind==='sign-in-required'?'Sign in to resume':'Waiting for connection'}</span>`);
}
