import type {App} from 'obsidian';

/** The root workspace document is stable when focus moves to a pop-out. */
export function workspaceDocument(app:App):Document{
  const root=app.workspace.containerEl?.ownerDocument;
  if(root)return root;
  if(typeof activeDocument!=='undefined')return activeDocument;
  throw Error('The Obsidian workspace document is unavailable.');
}

/** Install once in each existing or future workspace window. Own all event
 * subscriptions and release only that document's resources when it closes. */
export function watchWorkspaceDocuments(app:App,install:(root:Document)=>()=>void):()=>void{
  const documents=new Map<Document,()=>void>();
  const watch=(root:Document)=>{if(!documents.has(root))documents.set(root,install(root));};
  const close=(root:Document)=>{const dispose=documents.get(root);documents.delete(root);dispose?.();};
  const refs:ReturnType<App['workspace']['on']>[]=[];
  const dispose=()=>{for(const ref of refs)app.workspace.offref(ref);refs.length=0;for(const root of [...documents.keys()])close(root);};
  try{
    watch(workspaceDocument(app));
    app.workspace.iterateAllLeaves?.(leaf=>{const root=leaf.view.containerEl?.ownerDocument;if(root)watch(root);});
    if(typeof app.workspace.on==='function'){
      refs.push(app.workspace.on('window-open',(_workspace,win)=>watch(win.document)));
      refs.push(app.workspace.on('window-close',(_workspace,win)=>close(win.document)));
    }
  }catch(error){dispose();throw error;}
  return dispose;
}
