import {MarkdownRenderer,type App,type Component} from 'obsidian';
import type {ImportRun} from './run-import';
import type {HtmlResultViews} from '../responses/html-result-view';
import {htmlResultFrameHeight} from '../responses/html-results';

/** Render only the answer and visible HTML, without note bindings, streaming,
 * tool history, or any dispatch. The modal owns every render child. */
export async function renderRunImportPreview(app:App,run:ImportRun,element:HTMLElement,child:Component,signal:AbortSignal,views?:HtmlResultViews){
  if(signal.aborted)return;
  element.empty();const preview=run.preview;
  if(!preview||!preview.body&&!preview.html.length){element.setText(run.status==='Running'?'No response text yet.':'No response text was saved for this run.');return;}
  element.setAttribute('aria-label',run.status==='Running'?'Current response preview':'Response preview');
  // Links, checkboxes, embeds and HTML controls are display only. Keep input
  // with the native picker so Enter and Escape always retain their meaning.
  element.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
  element.addEventListener('keydown',event=>event.preventDefault());
  if(preview.body){const prose=element.createDiv({cls:'markdown-rendered'});await MarkdownRenderer.render(app,preview.body,prose,'',child);if(signal.aborted)return;prose.inert=true;}
  for(const reference of preview.html){
    if(signal.aborted)return;
    const slot=element.createDiv({cls:'send-to-t3-run-html-slot'});
    // The preview is clipped, not scrollable. Cards below that crop cannot be
    // seen and must not download or start five full app runtimes on hover.
    const top=slot.getBoundingClientRect().top-element.getBoundingClientRect().top;
    slot.style.height=htmlResultFrameHeight(reference,element.clientWidth||600)+'px';
    if(top>=element.clientHeight)continue;
    if(views){const mounted=views.mount(reference,element.ownerDocument,false,undefined,{passive:true});slot.append(mounted.root);child.register(()=>mounted.dispose());}
    else slot.setText(reference.title);
  }
}
