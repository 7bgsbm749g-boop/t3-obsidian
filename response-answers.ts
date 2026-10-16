import type {Question} from './questions';

/** Retained with the input checkpoint, independently of recent activity pages. */
export interface SubmittedAnswer {requestId:string;questions:Question[];answers?:Record<string,string|string[]>}
const html=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\r\n?|\n/g,'&#10;');
export function submittedAnswers(value:unknown):Record<string,string|string[]>|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  return Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string|string[]]=>typeof entry[1]==='string'||Array.isArray(entry[1])&&entry[1].every(item=>typeof item==='string')));
}
const answerText=(value:string|string[])=>Array.isArray(value)?value.join(', '):value;
/** A native disclosure keeps full question/answer text out of the stream row. */
export function renderSubmittedAnswer(answer:SubmittedAnswer,text:string,createdAt?:string):string {
  const entries=Object.entries(answer.answers??{}),preview=(entries.length?entries.map(([,value])=>answerText(value)).join(' · '):text).replace(/\s+/g,' ').trim();
  const questions=answer.questions.map(question=>{
    const value=answer.answers?.[question.id];
    return `<div class="send-to-t3-answer-pair"><p class="send-to-t3-answer-question">${html(question.question)}</p>${value!==undefined?`<p class="send-to-t3-answer-text">${html(answerText(value))}</p>`:''}</div>`;
  }).join('');
  const remaining=entries.filter(([id])=>!answer.questions.some(question=>question.id===id)).map(([,value])=>`<p class="send-to-t3-answer-text">${html(answerText(value))}</p>`).join('');
  const time=createdAt&&Number.isFinite(Date.parse(createdAt))?`<span class="send-to-t3-answer-time" title="${html(createdAt)}">${new Date(createdAt).toISOString().slice(11,16)} UTC</span>`:'';
  return `<details class="send-to-t3-answer" data-t3-answer-id="${html(answer.requestId)}"><summary><span data-t3-tool-icon="message-circle" aria-hidden="true"></span><span class="send-to-t3-answer-label">User input submitted</span><span class="send-to-t3-answer-preview">${html(preview.slice(0,160))}</span>${time}</summary><div class="send-to-t3-answer-content">${questions}${remaining}${!entries.length?`<p class="send-to-t3-answer-text">${html(text)}</p>`:''}</div></details>`;
}
