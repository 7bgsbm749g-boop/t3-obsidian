import {logEvent} from './diagnostics';
import {contentHash} from './completion';
import type {App,Editor,MarkdownView} from 'obsidian';
import {replaceInlineEditorText} from './inline-editor';

/** Real note writes, using the live editor when open and atomic vault edits
 * otherwise. Ownership is checked immediately before each actual mutation. */
export function deviceNoteIO(app:App){
  const editors=(path:string)=>app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file?.path===path&&view.editor).map(view=>view.editor);
  return {
    isOpen:(path:string)=>editors(path).length>0,
    isSaved:async(path:string,hash:string)=>{const file=app.vault.getFileByPath(path);return !!file&&contentHash(await app.vault.read(file))===hash;},
    readNote:async(path:string)=>{
      const open=editors(path);if(open.length){const value=open[0].getValue();return open.every(editor=>editor.getValue()===value)?value:undefined;}
      const file=app.vault.getFileByPath(path);return file?app.vault.read(file):undefined;
    },
    updateNote:async(path:string,change:(current:string)=>string,allowed:()=>boolean):Promise<string|undefined>=>{
      if(!allowed())throw Error('Writer ownership expired.');
      const open=editors(path);
      if(open.length){
        const editor=open[0],current=editor.getValue();if(!open.every(editor=>editor.getValue()===current))return;
        const next=change(current);
        if(!allowed())throw Error('Writer ownership expired.');
        if(next!==current){logEvent('note.write.editor',{notePath:path,fromHash:contentHash(current),toHash:contentHash(next)});replaceChangedText(editor,current,next);}
        return next;
      }
      const file=app.vault.getFileByPath(path);if(!file)return;
      const current=await app.vault.read(file);
      if(!allowed()||editors(path).length)throw Error('The note or its ownership changed; retrying.');
      const next=change(current);if(next===current)return current;
      const written=await app.vault.process(file,value=>{
        if(!allowed()||value!==current||editors(path).length)throw Error('The note or its ownership changed; retrying.');
        return next;
      });
      logEvent('note.write.saved',{notePath:path,fromHash:contentHash(current),toHash:contentHash(written)});return written;
    },
  };
}
export function replaceChangedText(editor:Editor,before:string,after:string){
  let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  let oldEnd=before.length,newEnd=after.length;while(oldEnd>start&&newEnd>start&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
  replaceInlineEditorText(editor,after.slice(start,newEnd),start,oldEnd);
}
