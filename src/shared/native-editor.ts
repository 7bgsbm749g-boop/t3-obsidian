import type {Editor,MarkdownView} from 'obsidian';
import type {EditorView} from '@codemirror/view';

/** Private host fields used only by the native adapter. Callers retain their
 * capability and file-identity checks; this does not supply a fallback editor. */
export type NativeMarkdownView=MarkdownView&{saving?:boolean;dirty?:boolean;lastSavedData?:string};
export function nativeMarkdownView(view:MarkdownView):NativeMarkdownView{return view;}
export function editorCM(editor:Editor|undefined):EditorView|undefined{
  const view:unknown=editor?Reflect.get(editor,'cm'):undefined;return view as EditorView|undefined;
}
