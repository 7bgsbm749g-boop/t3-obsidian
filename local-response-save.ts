export type LocalSavePendingReason='verification'|'sync'|'note-closed'|'note-unavailable'|'note-changed'|'stopped'|'save-error'|'saving'|'plugin-unavailable';
export type LocalResponseSaveResult={saved:true}|{saved:false;reason:LocalSavePendingReason};

export function localSavePendingMessage(reason:LocalSavePendingReason):string {
  switch(reason){
    case 'verification':return 'Waiting to verify the final response with T3.';
    case 'sync':return 'Waiting for Obsidian Sync to finish.';
    case 'note-closed':return 'Open the destination note to finish saving.';
    case 'note-unavailable':return 'The destination note is not available for saving.';
    case 'note-changed':return 'The destination changed before the response could be saved. Import the same run again to retry.';
    case 'stopped':return 'This response was stopped. Its final response has not been imported.';
    case 'save-error':return 'The final response could not be saved. Import the same run again to retry.';
    case 'plugin-unavailable':return 'The plugin is not available to finish saving.';
    case 'saving':return 'The final response is still being saved.';
  }
}
