import type {Extension} from '@codemirror/state';
import type {DecorationSet,EditorView,ViewUpdate} from '@codemirror/view';
import type {MarkdownPostProcessorContext} from 'obsidian';
import {responseBoundaries,responseFrame} from './response-container';

/** Match only complete plugin tracking comments, including beside user text. */
export function inlineMarkerRegex():RegExp {
  return /<!-- (?:(?:t3-inline|t3-response):(?:start|end):[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}|t3-(?:question|approval):(?:start|end):%7B[A-Za-z0-9%_.~-]+%7D) -->/g;
}

export function hiddenInlineMarkerExtension():Extension {
  // Obsidian supplies its own CodeMirror instance. Load that instance only when
  // registering the extension, so the decorations share the editor's classes.
  const {Decoration,EditorView,MatchDecorator,ViewPlugin}=require('@codemirror/view') as typeof import('@codemirror/view');
  const matcher=new MatchDecorator({regexp:inlineMarkerRegex(),decoration:Decoration.replace({})});
  const plugin=ViewPlugin.fromClass(class {
    decorations:DecorationSet;
    constructor(view:EditorView){this.decorations=matcher.createDeco(view);}
    update(update:ViewUpdate){this.decorations=matcher.updateDeco(update,this.decorations);}
  },{decorations:value=>value.decorations});
  // Multiline replacements must be direct state decorations. Hide the extra
  // container separator newline too, retaining the old comment-line geometry in
  // both Live Preview and Source mode. Literal containers in code stay visible.
  const {StateField}=require('@codemirror/state') as typeof import('@codemirror/state');
  const containers=(document:string)=>Decoration.set(responseBoundaries(document).filter(boundary=>boundary.format==='container').map(boundary=>{
    const from=boundary.from-(boundary.kind==='end'&&document.slice(boundary.from-2,boundary.from)==='\n\n'?1:0);
    const to=boundary.to+(boundary.kind==='start'&&document.slice(boundary.to,boundary.to+2)==='\n\n'?1:0);
    return Decoration.replace({}).range(from,to);
  }),true);
  const field=StateField.define<DecorationSet>({create:state=>containers(state.doc.toString()),update:(value,transaction)=>transaction.docChanged?containers(transaction.newDoc.toString()):value,provide:field=>EditorView.decorations.from(field)});
  return [plugin,EditorView.atomicRanges.of(view=>view.plugin(plugin)?.decorations??Decoration.none),field,EditorView.atomicRanges.of(view=>view.state.field(field))];
}

/** Hide only structurally matched directive paragraphs in Reading view.
 * Literal examples and damaged containers stay visible for review. */
export function hideResponseContainerBoundaries(element:HTMLElement,context:MarkdownPostProcessorContext):void {
  const paragraphs=[...(element.matches('p')?[element]:[]),...Array.from(element.querySelectorAll<HTMLElement>('p'))];
  for(const paragraph of paragraphs){
    if(!paragraph.textContent?.startsWith(':::'))continue;
    const info=context.getSectionInfo(paragraph);if(!info)continue;
    const boundaries=responseBoundaries(info.text),lines=info.text.split('\n');
    const start=lines.slice(0,info.lineStart).join('\n').length+(info.lineStart?1:0),end=lines.slice(0,info.lineEnd+1).join('\n').length;
    if(boundaries.some(boundary=>{
      if(boundary.format!=='container'||boundary.from<start||boundary.to>end||boundary.text!==paragraph.textContent)return false;
      try{return !!responseFrame(info.text,boundary.id);}catch{return false;}
    }))paragraph.addClass('send-to-t3-response-boundary');
  }
}
