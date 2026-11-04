import type {Hotkey} from 'obsidian';

type Activation={ctrlKey:boolean;metaKey:boolean;altKey:boolean;shiftKey:boolean;key:string};

/** Commands have no activation event. Track modifiers per window, and clear on
 * blur so releasing Control outside Obsidian cannot leave the picker enabled. */
export class SendGesture {
  private windows=new WeakMap<Window,Activation>();
  watch(win:Window):()=>void {
    const update=(event:KeyboardEvent)=>{this.windows.set(win,{ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey,shiftKey:event.shiftKey,key:event.key});};
    const clear=()=>{this.windows.delete(win);};
    const pointer=(event:MouseEvent)=>{this.windows.set(win,{ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey,shiftKey:event.shiftKey,key:''});};
    win.addEventListener('keydown',update,true);win.addEventListener('keyup',update,true);
    win.addEventListener('pointerdown',pointer,true);win.addEventListener('blur',clear);
    return ()=>{win.removeEventListener('keydown',update,true);win.removeEventListener('keyup',update,true);win.removeEventListener('pointerdown',pointer,true);win.removeEventListener('blur',clear);clear();};
  }
  selector(win?:Window|null,hotkeys:Hotkey[]=[],mac=false):boolean {
    const event=win&&this.windows.get(win);
    if(!event?.ctrlKey)return false;
    // Control required by the configured send shortcut is not an extra gesture.
    return !hotkeys.some(hotkey=>hotkey.key.toLowerCase()===event.key.toLowerCase()&&
      event.ctrlKey===hotkey.modifiers.some(mod=>mod==='Ctrl'||mod==='Mod'&&!mac)&&
      event.metaKey===hotkey.modifiers.some(mod=>mod==='Meta'||mod==='Mod'&&mac)&&
      event.altKey===hotkey.modifiers.includes('Alt')&&event.shiftKey===hotkey.modifiers.includes('Shift'));
  }
}
