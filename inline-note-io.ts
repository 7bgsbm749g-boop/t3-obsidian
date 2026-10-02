import {hasCompletionProof,hasResponseMarkers} from './inline-thread';
import {logEvent} from './diagnostics';
import {contentHash} from './completion';
import type {App,Editor,MarkdownView} from 'obsidian';
import {replaceInlineEditorText} from './inline-editor';
import {ResponseNoteLocator} from './response-location';

const locators=new WeakMap<App,ResponseNoteLocator>();
const missingNote=(error:unknown)=>!!error&&typeof error==='object'&&('code' in error&&error.code==='ENOENT'||'message' in error&&typeof error.message==='string'&&error.message.startsWith('ENOENT:'));

/** Real note writes, using the live editor when open and atomic vault edits
 * otherwise. Ownership is checked immediately before each actual mutation. */
export function deviceNoteIO(app:App){
  const editors=(path:string)=>app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file?.path===path&&view.editor).map(view=>view.editor);
  const readNote=async(path:string)=>{
    const open=editors(path);if(open.length){const value=open[0].getValue();return open.every(editor=>editor.getValue()===value)?value:undefined;}
    const file=app.vault.getFileByPath(path);if(!file)return;
    let document:string;
    try{document=await app.vault.read(file);}catch(error){if(missingNote(error))return;throw error;}
    return file.path!==undefined&&(file.path!==path||app.vault.getFileByPath(path)!==file)?undefined:document;
  };
  let locator=locators.get(app);
  if(!locator){locator=new ResponseNoteLocator(()=>app.vault.getMarkdownFiles?.().map(file=>file.path)??[],readNote);locators.set(app,locator);}
  const locations=locator;
  return {
    locateNote:(id:string,path:string)=>locations.locate(id,path),
    noteChanged:(path:string)=>locations.changed(path),
    noteRenamed:(before:string,after:string)=>locations.renamed(before,after),
    noteDeleted:(path:string)=>locations.deleted(path),
    isOpen:(path:string)=>editors(path).length>0,
    isSaved:async(path:string,hash:string,proof?:{id:string;body:string;cleaned?:boolean})=>{const file=app.vault.getFileByPath(path);if(!file)return false;let document:string;try{document=await app.vault.read(file);}catch(error){if(missingNote(error))return false;throw error;}if(file.path!==undefined&&(file.path!==path||app.vault.getFileByPath(path)!==file))return false;return proof?.cleaned?!hasResponseMarkers(document,proof.id):contentHash(document)===hash||!!proof&&hasCompletionProof(document,proof.id,proof.body);},
    readNote,
    updateNote:async(path:string,change:(current:string)=>string,allowed:()=>boolean):Promise<string|undefined>=>{
      if(!allowed())throw Error('Writer ownership expired.');
      const open=editors(path);
      if(open.length){
        const editor=open[0],current=editor.getValue();if(!open.every(editor=>editor.getValue()===current))return;
        const next=change(current);
        if(!allowed())throw Error('Writer ownership expired.');
        if(next!==current){logEvent('note.write.editor',{notePath:path,fromHash:contentHash(current),toHash:contentHash(next)});replaceChangedText(editor,current,next);}
        locations.remember(path,next);
        return next;
      }
      const file=app.vault.getFileByPath(path);if(!file)return;
      const stillHere=()=>file.path===undefined||file.path===path&&app.vault.getFileByPath(path)===file;
      let current:string;
      try{current=await app.vault.read(file);}catch(error){if(missingNote(error))return;throw error;}
      if(!allowed()||!stillHere()||editors(path).length)throw Error('The note or its ownership changed; retrying.');
      const next=change(current);if(next===current)return current;
      const written=await app.vault.process(file,value=>{
        if(!allowed()||!stillHere()||value!==current||editors(path).length)throw Error('The note or its ownership changed; retrying.');
        return next;
      });
      locations.remember(path,written);
      logEvent('note.write.saved',{notePath:path,fromHash:contentHash(current),toHash:contentHash(written)});return written;
    },
  };
}
export function replaceChangedText(editor:Editor,before:string,after:string){
  let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  let oldEnd=before.length,newEnd=after.length;while(oldEnd>start&&newEnd>start&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
  replaceInlineEditorText(editor,after.slice(start,newEnd),start,oldEnd);
}
