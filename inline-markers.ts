import type {Extension} from '@codemirror/state';
import type {DecorationSet,EditorView,ViewUpdate} from '@codemirror/view';

/** Match only the plugin's complete tracking lines, never other HTML comments. */
export function inlineMarkerRegex():RegExp {
  return /^<!-- (?:(?:t3-inline|t3-response):(?:start|end):[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}|t3-question:(?:start|end):%7B[A-Za-z0-9%_.~-]+%7D) -->$/g;
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
  return [plugin,EditorView.atomicRanges.of(view=>view.plugin(plugin)?.decorations??Decoration.none)];
}
