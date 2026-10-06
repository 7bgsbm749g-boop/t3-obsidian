/** Patch ordinary rendered Markdown in place. Native embeds and code-block
 * processors keep their new render children; plain text, folds and tool details
 * retain nodes instead of disappearing between token updates. */
export function reconcileResponseDOM(current:Element,incoming:Element){
  if(current.isEqualNode(incoming))return;
  if(current.hasAttribute('data-t3-tool-icon')&&current.getAttribute('data-t3-tool-icon')===incoming.getAttribute('data-t3-tool-icon')&&current.childNodes.length)return;
  const preserveOpen=current.tagName==='DETAILS',open=current.hasAttribute('open');
  for(const attribute of Array.from(current.attributes))if(!incoming.hasAttribute(attribute.name)&&!(preserveOpen&&attribute.name==='open'))current.removeAttribute(attribute.name);
  for(const attribute of Array.from(incoming.attributes))if(!(preserveOpen&&attribute.name==='open')&&current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
  const keyed=new Map(Array.from(current.children).filter(el=>el.hasAttribute('data-t3-tool-id')).map(el=>[el.getAttribute('data-t3-tool-id'),el]));
  const incomingKeys=new Set(Array.from(incoming.children).map(el=>el.getAttribute('data-t3-tool-id')).filter(Boolean));
  let cursor=current.firstChild;
  for(const next of Array.from(incoming.childNodes)){
    const key=next.nodeType===1?(next as Element).getAttribute('data-t3-tool-id'):null;
    const matching=key?keyed.get(key):undefined;
    if(matching&&matching!==cursor){current.insertBefore(matching,cursor);cursor=matching;}
    const native=next.nodeType===1&&((next as Element).matches('a, button, .internal-embed, [class*="block-language-"], .math, .mermaid'));
    const oldKey=cursor?.nodeType===1?(cursor as Element).getAttribute('data-t3-tool-id'):null;
    if(cursor&&!native&&key===oldKey&&cursor.nodeType===next.nodeType&&(next.nodeType!==1||(cursor as Element).tagName===(next as Element).tagName)){
      if(next.nodeType===1)reconcileResponseDOM(cursor as Element,next as Element);
      else if(cursor.nodeValue!==next.nodeValue)cursor.nodeValue=next.nodeValue;
      cursor=cursor.nextSibling;
    }else {const node=next;current.insertBefore(node,cursor);if(cursor&&!(oldKey&&incomingKeys.has(oldKey))){const old=cursor;cursor=cursor.nextSibling;old.remove();}}
  }
  while(cursor){const old=cursor;cursor=cursor.nextSibling;old.remove();}
  if(preserveOpen)current.toggleAttribute('open',open);
}
