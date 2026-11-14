import {selectionAnchor,type SelectionAnchor} from '../conversations/inline-thread';
import {selectionRange} from '../conversations/inline-steering';
import {responseIds,responseFrame} from '../responses/response-container';

/** A final save removes a projection's frame, not the selected prose. Rebase
 * only that exact, unique prose after its parent frame has actually gone. */
export function savedSelectionAnchor(document:string,anchor:SelectionAnchor,captured=document):SelectionAnchor|undefined{
  const range=selectionRange(document,anchor);
  if(range&&!responseIds(document).some(id=>{const frame=responseFrame(document,id);return frame&&range.from<frame.to&&range.to>frame.from;}))return selectionAnchor(document,anchor.text,range.from,range.to);
  const parent=responseIds(captured).find(id=>{const frame=responseFrame(captured,id);return frame&&anchor.start>=frame.from&&anchor.end<=frame.to;});
  if(!parent||responseIds(document).includes(parent))return;
  const at=document.indexOf(anchor.text);
  if(at<0||document.indexOf(anchor.text,at+1)>=0)return;
  return selectionAnchor(document,anchor.text,at,at+anchor.text.length);
}
