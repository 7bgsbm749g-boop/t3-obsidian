import {nativeResponses} from './native-response-manager';
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
  const views=(path:string)=>app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file?.path===path);
  // Reading view retains a hidden editor buffer. Mutating it neither renders
  // nor saves the reply; use the vault's atomic write for those views.
  const openViews=(path:string)=>views(path).filter(view=>view.editor&&view.getMode?.()!=='preview');
  const editors=(path:string)=>openViews(path).map(view=>view.editor);
  const saved=(view:MarkdownView)=>nativeResponses(app).view(view)?.saved()??view.getViewData?.()??view.editor.getValue();
  const stable=(open:MarkdownView[],path:string,value:string)=>{const current=openViews(path);return current.length===open.length&&open.every(view=>current.includes(view)&&saved(view)===value);};
  const boundaries=(text:string)=>[...text.matchAll(/^<!-- t3-(?:inline|response):(?:start|end):[0-9a-f-]{36} -->$/gm)].map(match=>match[0]).join('\n');
  const agreesWithDisk=async(path:string,value:string)=>{
    if(!app.vault?.getFileByPath)return true;const file=app.vault.getFileByPath(path);if(!file)return false;
    const disk=await app.vault.read(file);return boundaries(disk)===boundaries(value);
  };
  const readNote=async(path:string)=>{
    const open=openViews(path);if(open.length){const value=saved(open[0]);return stable(open,path,value)&&await agreesWithDisk(path,value)&&stable(open,path,value)?value:undefined;}
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
    noteRelocated:(id:string,before:string,after:string,previousHash?:string)=>locations.relocated(id,before,after,previousHash),
    noteDeleted:(path:string)=>locations.deleted(path),
    isOpen:(path:string)=>views(path).length>0,
    isSaved:async(path:string,hash:string,proof?:{id:string;body:string;cleaned?:boolean})=>{const file=app.vault.getFileByPath(path);if(!file)return false;let document:string;try{document=await app.vault.read(file);}catch(error){if(missingNote(error))return false;throw error;}if(file.path!==undefined&&(file.path!==path||app.vault.getFileByPath(path)!==file))return false;return proof?.cleaned?!hasResponseMarkers(document,proof.id):contentHash(document)===hash||!!proof&&hasCompletionProof(document,proof.id,proof.body);},
    readNote,
    updateNote:async(path:string,change:(current:string)=>string,allowed:()=>boolean):Promise<string|undefined>=>{
      if(!allowed())throw Error('Writer ownership expired.');
      const open=openViews(path);
      if(open.length){
        const current=saved(open[0]);if(!stable(open,path,current)||!await agreesWithDisk(path,current)||!stable(open,path,current))return;
        const next=change(current);
        if(!allowed())throw Error('Writer ownership expired.');
        if(next!==current){logEvent('note.write.editor',{notePath:path,fromHash:contentHash(current),toHash:contentHash(next)});for(const view of open){const adapter=nativeResponses(app).view(view);if(adapter)adapter.editSaved(next);else replaceChangedText(view.editor,current,next);}}
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
