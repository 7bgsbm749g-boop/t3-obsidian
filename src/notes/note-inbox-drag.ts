import type {InboxAction,InboxNote} from './note-inbox';

type Destination='pinned'|'regular'|'settled';
interface DragHost {enabled():boolean;notes():InboxNote[];selected(path:string):string[];change(note:InboxNote,action:InboxAction):Promise<void>;error(error:unknown):void}
/** Native file drags remain usable outside the inbox. Inside it, drops organize
 * notes rather than invoking Obsidian's physical folder-move handlers. */
export class NoteInboxDrag {
  private source?:InboxNote[];private zones:HTMLElement[]=[];
  constructor(private root:HTMLElement,private tree:HTMLElement,private host:DragHost){
    root.addEventListener('dragstart',this.start,true);
    for(const name of ['dragenter','dragover'] as const)root.addEventListener(name,this.over,true);
    root.addEventListener('drop',this.drop,true);
    tree.addEventListener('scroll',this.position);
    root.ownerDocument.addEventListener('dragend',this.finish,true);
    root.ownerDocument.addEventListener('drop',this.finish);
    root.ownerDocument.addEventListener('keydown',this.key,true);
  }
  private inside(event:DragEvent){return this.host.enabled()&&!!event.target&&this.tree.contains(event.target as Node);}
  private start=(event:DragEvent)=>{
    if(!this.inside(event))return;
    const target=event.target as HTMLElement;
    if(target.closest('input,textarea,[contenteditable="true"]'))return;
    const path=target.closest('[data-path]')?.getAttribute('data-path');if(!path)return;
    const paths=this.host.selected(path),notes=this.host.notes(),source=paths.map(path=>notes.find(note=>note.path===path));
    if(!source.length||source.some(note=>!note))return;
    this.finish();this.source=source as InboxNote[];this.tree.classList.add('t3-note-inbox-dragging');
    for(const [destination,label] of [['pinned','Pinned'],['settled','Settled']] as const){
      const zone=this.tree.createDiv({cls:'t3-note-inbox-drop-target',text:label,attr:{'data-t3-inbox-drop':destination,'aria-hidden':'true'}});this.zones.push(zone);
    }
    this.position();
  };
  private position=()=>{
    if(!this.source)return;
    this.zones[0]?.setCssProps({'--t3-inbox-drop-top':`${this.tree.scrollTop+4}px`});
    this.zones[1]?.setCssProps({'--t3-inbox-drop-top':`${this.tree.scrollTop+Math.max(36,this.tree.clientHeight-36)}px`});
  };
  private notes(){
    const notes=this.host.notes();
    return this.source?.map(original=>notes.find(note=>note.path===original.path&&note.activity===original.activity&&JSON.stringify(note.ids)===JSON.stringify(original.ids)));
  }
  private destination(event:DragEvent):Destination|undefined {
    const target=event.target as HTMLElement,direct=target.closest('[data-t3-inbox-drop]')?.getAttribute('data-t3-inbox-drop');
    if(direct==='pinned'||direct==='settled')return direct;
    if(target.closest('[data-t3-inbox-shelf="settled"]'))return 'settled';
    const path=target.closest('[data-path]')?.getAttribute('data-path'),note=this.host.notes().find(note=>note.path===path);
    if(note&&['pinned','regular','settled'].includes(note.section))return note.section as Destination;
    const zone=this.zones.find(zone=>{const rect=zone.getBoundingClientRect();return rect.height>0&&event.clientY>=rect.top&&event.clientY<=rect.bottom;});
    return zone?.getAttribute('data-t3-inbox-drop') as Destination|undefined;
  }
  private allowed(event:DragEvent){
    const destination=this.destination(event),notes=this.notes();
    return destination&&notes?.length&&notes.every(note=>!!note&&(destination!=='settled'||!note.indicator.active&&!note.indicator.input))?destination:undefined;
  }
  private over=(event:DragEvent)=>{
    if(!this.inside(event))return;
    event.preventDefault();event.stopImmediatePropagation();
    const destination=this.allowed(event);if(event.dataTransfer)event.dataTransfer.dropEffect=destination?'move':'none';
    for(const zone of this.zones)zone.classList.toggle('is-over',zone.getAttribute('data-t3-inbox-drop')===destination);
  };
  private drop=(event:DragEvent)=>{
    if(!this.inside(event))return;
    event.preventDefault();event.stopImmediatePropagation();
    const destination=this.allowed(event),notes=this.notes();this.finish();
    if(!destination||!notes)return;
    void (async()=>{
      for(const note of notes){
        if(!note)continue;
        if(destination==='regular'){
          if(note.pinned)await this.host.change(note,{kind:'pin',value:false});
          await this.host.change(note,{kind:'regular'});
        }else await this.host.change(note,destination==='pinned'?{kind:'pin',value:true}:{kind:'settled'});
      }
    })().catch(error=>this.host.error(error));
  };
  private key=(event:KeyboardEvent)=>{if(event.key==='Escape')this.finish();};
  private finish=()=>{
    this.source=undefined;for(const zone of this.zones)zone.remove();this.zones=[];
    // Native folder indicators observe class changes and refresh this view.
    // Removing an absent token still writes the attribute and repeats that loop.
    if(this.tree.classList.contains('t3-note-inbox-dragging'))this.tree.classList.remove('t3-note-inbox-dragging');
  };
  refresh(){if(!this.host.enabled()||this.notes()?.some(note=>!note))this.finish();}
  dispose(){
    this.finish();this.root.removeEventListener('dragstart',this.start,true);
    for(const name of ['dragenter','dragover'] as const)this.root.removeEventListener(name,this.over,true);
    this.root.removeEventListener('drop',this.drop,true);this.tree.removeEventListener('scroll',this.position);
    this.root.ownerDocument.removeEventListener('dragend',this.finish,true);this.root.ownerDocument.removeEventListener('drop',this.finish);this.root.ownerDocument.removeEventListener('keydown',this.key,true);
  }
}
