import type {MarkdownView} from 'obsidian';

/** Status only: never enters the editor document, prompt, or saved reply. */
export function queuedEditIndicator(view:MarkdownView,count:number){
  let indicator=view.contentEl.querySelector<HTMLElement>(':scope > .send-to-t3-queued-edit');
  if(!count){indicator?.remove();return;}
  if(!indicator){indicator=view.contentEl.createDiv({cls:'send-to-t3-queued-edit',attr:{role:'status','aria-live':'polite'}});view.contentEl.prepend(indicator);}
  indicator.textContent=count===1?'Note edit waiting for final save':`${count} note edits waiting for final save`;
  indicator.title='The agent proposal is retained. It will be checked and merged with your edits when the reply finishes or stops.';
}
