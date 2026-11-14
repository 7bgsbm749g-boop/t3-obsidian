/** The only plugin clipboard action is an explicit Copy run ID menu click. */
export async function copyRunId(win:Window|null,runId:string){
  if(!win||!runId||runId.length>256||!/^[a-zA-Z0-9:_.-]+$/.test(runId))throw Error('The application run ID is unavailable.');
  await win.navigator.clipboard.writeText(runId);
}
