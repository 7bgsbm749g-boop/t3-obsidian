import type {MarkdownView} from 'obsidian';
import {streamBlock,removeStreamBlock} from './stream-block';

/** Completed history is ordinary Markdown. Use the current editor document
 * and native undo/autosave; no response identity, host or receipt is needed. */
export function removeStreamBlockFromEditor(view:Pick<MarkdownView,'editor'|'requestSave'>,key:string,saved:string):boolean {
  const block=streamBlock(saved,key);
  if(!block?.complete||block.tracked)return false;
  // Live Preview may compact retained tool output. Its offsets belong to the
  // displayed editor document, rather than the full saved Markdown.
  const removal=removeStreamBlock(view.editor.getValue(),key);
  view.editor.replaceRange('',view.editor.offsetToPos(removal.from),view.editor.offsetToPos(removal.to));
  view.requestSave();return true;
}
