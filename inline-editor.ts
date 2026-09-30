import type {Editor} from 'obsidian';
import type {EditorView} from '@codemirror/view';

/** Obsidian's replaceRange forces the cursor into view. Background response
 * updates must let CodeMirror map selections and anchor the viewport instead. */
export function replaceInlineEditorText(editor:Editor,text:string,from:number,to=from){
  const cm=(editor as Editor&{cm?:Pick<EditorView,'dispatch'>&Partial<Pick<EditorView,'state'|'scrollDOM'|'coordsAtPos'>>}).cm;
  if(cm){
    // If the viewport starts inside a question that disappears, CodeMirror's
    // top-line anchor is also replaced. Anchor an unchanged visible paragraph
    // below the edit instead, after layout has settled.
    let anchor:number|undefined,top:number|undefined;
    if(cm.state&&cm.scrollDOM&&cm.coordsAtPos){
      const bounds=cm.scrollDOM.getBoundingClientRect(),doc=cm.state.doc;
      for(let number=doc.lineAt(to).number+1;number<=doc.lines;number++){
        const line=doc.line(number);if(!line.text.trim()||/^<!-- t3-(?:inline|question):/.test(line.text))continue;
        const coords=cm.coordsAtPos(line.from);
        if(coords&&coords.top>=bounds.top&&coords.bottom<=bounds.bottom){anchor=line.from;top=coords.top;break;}
      }
    }
    const effects=anchor!==undefined&&top!==undefined&&cm.scrollDOM
      ?require('@codemirror/view').EditorView.scrollIntoView(anchor+text.length-(to-from),{y:'start',yMargin:top-cm.scrollDOM.getBoundingClientRect().top})
      :undefined;
    // Let CodeMirror apply the anchor after its own measurement and scroll
    // correction. A requestMeasure write is too early in Obsidian's layout.
    cm.dispatch({changes:{from,to,insert:text},effects,scrollIntoView:false,userEvent:'send-to-t3-code'});
    return;
  }
  // Older editor implementations expose only the public Obsidian API.
  const scroll=editor.getScrollInfo?.();
  editor.replaceRange(text,editor.offsetToPos(from),editor.offsetToPos(to),'send-to-t3-code');
  if(scroll)editor.scrollTo(scroll.left,scroll.top);
}
