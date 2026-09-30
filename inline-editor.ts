import type {Editor} from 'obsidian';
import type {EditorView} from '@codemirror/view';

/** Obsidian's replaceRange forces the cursor into view. Background response
 * updates must let CodeMirror map selections and anchor the viewport instead. */
export function replaceInlineEditorText(editor:Editor,text:string,from:number,to=from){
  const cm=(editor as Editor&{cm?:Pick<EditorView,'dispatch'>}).cm;
  if(cm){
    cm.dispatch({changes:{from,to,insert:text},scrollIntoView:false,userEvent:'send-to-t3-code'});
    return;
  }
  // Older editor implementations expose only the public Obsidian API.
  const scroll=editor.getScrollInfo?.();
  editor.replaceRange(text,editor.offsetToPos(from),editor.offsetToPos(to),'send-to-t3-code');
  if(scroll)editor.scrollTo(scroll.left,scroll.top);
}
