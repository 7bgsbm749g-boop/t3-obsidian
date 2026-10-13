import {nativeResponses} from './native-response-manager';
import {hasCompletionProof,hasResponseMarkers} from './inline-thread';
import {logEvent} from './diagnostics';
import {logFailure} from './diagnostics';
import {contentHash} from './completion';
import type {App,Editor,MarkdownView} from 'obsidian';
import {replaceInlineEditorText} from './inline-editor';
import {ResponseNoteLocator} from './response-location';
import {responseAnchor,responseRegion} from './native-response-projection';
import {responseIds,responseBoundaries} from './response-container';
import type {FinalWriteOutcome} from './completion-attempt';

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
  const boundaries=(text:string)=>responseBoundaries(text).map(({id,kind,format,text})=>JSON.stringify([id,kind,format,text])).join('\n');
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
        if(next!==current){
          logEvent('note.write.editor',{notePath:path,fromHash:contentHash(current),toHash:contentHash(next)});
          for(const view of open){const adapter=nativeResponses(app).view(view);if(adapter)adapter.editSaved(next);else replaceChangedText(view.editor,current,next);}
          // Registration must reach disk before a local native projection can
          // interpret a missing anchor as an incoming deletion. Obsidian's
          // pending autosave otherwise races the host's registration reply.
          const newNativeAnchor=responseIds(next).some(id=>{
            const region=responseRegion(next,id);return !responseRegion(current,id)&&!!region&&next.slice(region.from,region.to)===responseAnchor(id,next);
          });
          if(newNativeAnchor){
            for(const view of open)await view.save();
            if(!allowed()||!stable(open,path,next)||!await agreesWithDisk(path,next)||!stable(open,path,next))throw Error('The response boundaries were not saved. Save the note and retry.');
          }
        }
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

/** Commit the live saved projection, including ordinary unsaved edits. Native
 * saves first reconcile their disk baseline; every pane must then agree with
 * disk before the single final atomic mutation is prepared. */
export function deviceFinalNoteIO(app:App,allowed:()=>boolean){
  const io=deviceNoteIO(app),manager=nativeResponses(app);
  const observed=new Map<string,{file:unknown;disk:string;current:string}>();
  const recovered=new Map<string,{file:unknown;expected:string}>();
  const acquire=async(path:string,review=false)=>manager.beginFinalSave(path,review);
  const compareAndSetAttempt=async(path:string,before:string,after:string,_attemptId:string):Promise<FinalWriteOutcome>=>{
    let release:(()=>void)|undefined,prepared=false,written=false,ioStarted=false;
    const changed=Error('The local note changed before final save.');
    try{
      release=await acquire(path);
      const file=app.vault.getFileByPath(path);if(!file||!allowed())return {status:'no-write'};
      const same=()=>allowed()&&file.path===path&&app.vault.getFileByPath(path)===file&&manager.finalSaveReady(path)&&manager.savedViews(path).every(view=>view.saved()===before);
      const snapshot=observed.get(path);
      if(!snapshot||snapshot.file!==file||snapshot.current!==before||!same()||await app.vault.read(file)!==snapshot.disk||!same())return {status:'no-write'};
      const ids=responseIds(before).filter(id=>responseRegion(before,id)&&!responseRegion(after,id));
      // Preparing several panes can fail after an earlier pane installed its
      // intent. Cancel every pane even when that operation does not return.
      prepared=true;manager.prepare(path,before,after,ids);
      ioStarted=true;await app.vault.process(file,current=>{if(!same()||current!==snapshot.disk)throw changed;return after;});written=true;
      const disk=await app.vault.read(file);
      if(!allowed()||file.path!==path||app.vault.getFileByPath(path)!==file||disk!==after||!manager.finalSaveReady(path))return {status:'written-unverified'};
      manager.committed(path,disk,ids);return {status:'verified'};
    }catch(error){
      if(error===changed)return {status:'no-write'};
      logFailure('response.device-completion.final-save',error,{notePath:path});
      return {status:written?'written-unverified':ioStarted?'unknown':'no-write'};
    }finally{if(prepared)manager.cancel(path);release?.();}
  };
  return {
    readCommitted:async(path:string)=>{
      const file=app.vault.getFileByPath(path);if(!file||!allowed())return;
      const disk=await app.vault.read(file);
      if(allowed()&&file.path===path&&app.vault.getFileByPath(path)===file)return disk;
    },
    reviewRead:async(path:string)=>{
      const release=await acquire(path,true);try{
        const file=app.vault.getFileByPath(path);if(!file||!allowed())return;
        const disk=await app.vault.read(file);if(!allowed()||file.path!==path||app.vault.getFileByPath(path)!==file||!manager.finalSaveReady(path))return;
        return manager.reviewSaved(path,disk);
      }finally{release();}
    },
    resumeReviewed:async(path:string,currentHash:string)=>{
      const release=await acquire(path,true);try{
        const file=app.vault.getFileByPath(path);if(!file||!allowed())throw Error('The reviewed note is unavailable.');
        const disk=await app.vault.read(file),current=manager.reviewSaved(path,disk);
        if(!allowed()||file.path!==path||app.vault.getFileByPath(path)!==file||!manager.finalSaveReady(path)||current===undefined||contentHash(current)!==currentHash)throw Error('The reviewed note changed before completion recovery.');
        manager.resumeReviewed(path,disk,current);
      }finally{release();}
    },
    recover:async(path:string,expected:string,ids:string[])=>{
      const release=await acquire(path,true);try{
      const file=app.vault.getFileByPath(path);if(!file||!allowed())return;
      if(await app.vault.read(file)!==expected||!allowed()||file.path!==path||app.vault.getFileByPath(path)!==file||!manager.finalSaveReady(path))return;
      recovered.set(path,{file,expected});
      try{manager.committed(path,expected,ids);}catch(error){logFailure('response.device-completion.pane-recovery',error,{notePath:path});}
      }finally{release();}
    },
    read:async(path:string)=>{
      observed.delete(path);const release=await acquire(path);
      try{
      const file=app.vault.getFileByPath(path);if(!file||!allowed())return;
      const disk=await app.vault.read(file);if(!allowed()||file.path!==path||app.vault.getFileByPath(path)!==file||!manager.finalSaveReady(path))return;
      const own=recovered.get(path);if(own?.file===file&&own.expected===disk)return disk;
      for(const {view} of manager.savedViews(path))manager.view(view)?.reconcileDisk(disk);
      const current=await io.readNote(path);if(!manager.finalSaveReady(path))return;if(current!==undefined)observed.set(path,{file,disk,current});return current;
      }finally{release();}
    },
    compareAndSetAttempt,
    compareAndSet:async(path:string,before:string,after:string)=>(await compareAndSetAttempt(path,before,after,'legacy')).status==='verified',
  };
}
