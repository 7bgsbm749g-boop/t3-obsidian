import type {TFolder} from 'obsidian';

/** Narrow capability boundary for Obsidian's existing file-explorer virtual
 * tree. A filtered native tree must also own selection and keyboard order. */
export interface NativeTreeItem {
  file?:{path:string;parent?:TFolder|null};el:HTMLElement;selfEl:HTMLElement;innerEl?:HTMLElement;coverEl?:HTMLElement;parent?:NativeTreeItem;
  info:Record<string,unknown>&{height?:number;hidden?:boolean;computed?:boolean};selectable?:boolean;rendered?:boolean;
  onRender?:()=>void;
}
interface NativeRoot extends NativeTreeItem {vChildren:{children:NativeTreeItem[];setChildren(items:NativeTreeItem[]):void}}
export interface NativeExplorerTree {
  ready?:boolean;
  fileItems:Record<string,NativeTreeItem>;
  getSortedFolderItems:(folder:TFolder)=>NativeTreeItem[];
  getNodeId:(item:NativeTreeItem)=>unknown;
  isItem:(item:unknown)=>boolean;
  sort():void;
  tree:{root:NativeRoot;selectedDoms:Set<NativeTreeItem>;focusedItem:NativeTreeItem|null;clearSelectedDoms():void;deselectItem(item:NativeTreeItem):void;saveFolds?:()=>void;requestSaveFolds?:{():void;cancel?():unknown;run?():unknown};infinityScroll:{invalidateAll():unknown}};
}
export function nativeExplorerTree(value:unknown):NativeExplorerTree|undefined {
  const v=value as Partial<NativeExplorerTree>|undefined,root=v?.tree?.root;
  return v&&v.ready!==false&&root?.vChildren&&typeof root.vChildren.setChildren==='function'&&typeof v.getSortedFolderItems==='function'&&typeof v.getNodeId==='function'&&typeof v.isItem==='function'&&typeof v.sort==='function'&&!!v.tree?.selectedDoms&&typeof v.tree.selectedDoms.values==='function'&&typeof v.tree.clearSelectedDoms==='function'&&typeof v.tree.deselectItem==='function'&&typeof v.tree.infinityScroll?.invalidateAll==='function'?v as NativeExplorerTree:undefined;
}
interface Control {node:NativeTreeItem;id:string}
export class NativeInboxTree {
  private active=false;private stopped=false;private queued=false;private desired:NativeTreeItem[]=[];private controls=new Map<HTMLElement,Control>();
  private originalSorted:NativeExplorerTree['getSortedFolderItems'];private originalId:NativeExplorerTree['getNodeId'];private originalItem:NativeExplorerTree['isItem'];
  private sorted:NativeExplorerTree['getSortedFolderItems'];private nodeId:NativeExplorerTree['getNodeId'];private isItem:NativeExplorerTree['isItem'];
  private signature:unknown[]=[];
  private originalFolds?:()=>void;private saveFolds?:()=>void;
  private originalRequestFolds?:NativeExplorerTree['tree']['requestSaveFolds'];private requestFolds?:NativeExplorerTree['tree']['requestSaveFolds'];
  private descriptors:Record<string,PropertyDescriptor|undefined>;
  constructor(private view:NativeExplorerTree){
    this.originalSorted=view.getSortedFolderItems;this.originalId=view.getNodeId;this.originalItem=view.isItem;
    this.descriptors=Object.fromEntries(['getSortedFolderItems','getNodeId','isItem'].map(key=>[key,Object.getOwnPropertyDescriptor(view,key)]));
    this.descriptors.saveFolds=Object.getOwnPropertyDescriptor(view.tree,'saveFolds');this.descriptors.requestSaveFolds=Object.getOwnPropertyDescriptor(view.tree,'requestSaveFolds');
    this.sorted=(folder)=>{
      if(!this.active||this.stopped)return this.base('getSortedFolderItems',this.originalSorted).call(view,folder);
      if(folder.path!=='/')this.base('getSortedFolderItems',this.originalSorted).call(view,folder);
      this.reconcileSoon();
      return folder.path==='/'?this.current():[];
    };
    this.nodeId=(item)=>{const control=this.controls.get(item?.el);return control?.node===item?control.id:this.base('getNodeId',this.originalId).call(view,item);};
    this.isItem=(item)=>{return this.isControl(item)?false:this.base('isItem',this.originalItem).call(view,item);};
    view.getSortedFolderItems=this.sorted;view.getNodeId=this.nodeId;view.isItem=this.isItem;
    if(view.tree.saveFolds){this.originalFolds=view.tree.saveFolds;this.saveFolds=()=>{if(!this.active)this.originalFolds?.call(view.tree);};view.tree.saveFolds=this.saveFolds;}
    if(view.tree.requestSaveFolds){
      const original=this.originalRequestFolds=view.tree.requestSaveFolds;
      this.requestFolds=Object.assign(()=>{if(!this.active)original.call(view.tree);},{cancel:()=>original.cancel?.(),run:()=>{if(!this.active)return original.run?.();}});view.tree.requestSaveFolds=this.requestFolds;
    }
  }
  private base<K extends 'getSortedFolderItems'|'getNodeId'|'isItem'>(key:K,original:NativeExplorerTree[K]):NativeExplorerTree[K]{const prototype=Object.getPrototypeOf(this.view) as Partial<NativeExplorerTree>|null,method=prototype?.[key];return !this.descriptors[key]&&typeof method==='function'?method as NativeExplorerTree[K]:original;}
  private isControl(value:unknown){const node=value as NativeTreeItem|undefined;return !!node&&this.controls.get(node.el)?.node===node;}
  /** Structural controls reuse the native virtual-item lifecycle, never a
   * TFile, file registry entry, status row, or selectable note. */
  control(element:HTMLElement,id:string,sample:NativeTreeItem):NativeTreeItem {
    const existing=this.controls.get(element);if(existing)return existing.node;
    const node=Object.assign(Object.create(Object.getPrototypeOf(sample) as object|null) as NativeTreeItem,sample);
    delete node.file;
    Object.assign(node,{el:element,selfEl:element,innerEl:element,coverEl:element.ownerDocument.win.createDiv(),rendered:false,selectable:false,collapsible:false,collapsed:false,tagEl:null,onRender:()=>{},getTitle:()=>'',isSupported:()=>false,onSelfClick:()=>{}});
    node.info={...sample.info,computed:false,hidden:false,height:0,childTop:0,childLeft:0,childLeftPadding:0,queued:false,next:false};
    this.controls.set(element,{node,id});return node;
  }
  update(items:NativeTreeItem[]){
    if(this.stopped)return;
    const changed=!this.active||items.length!==this.signature.length||items.some((item,index)=>item!==this.signature[index]);
    if(!this.active){this.originalRequestFolds?.cancel?.();this.view.tree.saveFolds?.();}
    this.desired=items;this.active=true;
    if(changed){this.signature=[...items];this.view.tree.clearSelectedDoms();this.view.tree.focusedItem=null;this.view.sort();this.reconcile();this.layout();}
  }
  private current(){
    const folders=new Map<string,Set<NativeTreeItem>>();
    return this.desired.filter(item=>{
      if(this.isControl(item))return true;
      if(!item.file||this.view.fileItems[item.file.path]!==item)return false;
      const parent=item.file.parent;if(!parent)return true;
      let allowed=folders.get(parent.path);if(!allowed){allowed=new Set(this.base('getSortedFolderItems',this.originalSorted).call(this.view,parent));folders.set(parent.path,allowed);}
      return allowed.has(item);
    });
  }
  get items(){return this.view.tree.root.vChildren.children;}
  private reconcileSoon(){if(this.queued||this.stopped)return;this.queued=true;void Promise.resolve().then(()=>{this.queued=false;if(this.active&&!this.stopped)this.reconcile();});}
  private reconcile(){
    const root=this.view.tree.root,items=this.current(),allowed=new Set(items.filter(item=>!this.isControl(item)));
    for(const selected of this.view.tree.selectedDoms)if(!allowed.has(selected))this.view.tree.deselectItem(selected);
    if(this.view.tree.focusedItem&&!allowed.has(this.view.tree.focusedItem))this.view.tree.focusedItem=null;
    // Native folder updates can run after the root sort. Repair the projected
    // parent links before any selection command can walk the tree.
    for(const item of items)item.parent=root;
    const children=root.vChildren.children;
    if(children.length!==items.length||items.some((item,index)=>item!==children[index])){root.vChildren.setChildren(items);this.view.tree.infinityScroll.invalidateAll();}
  }
  layout(){if(this.active&&!this.stopped)this.view.tree.infinityScroll.invalidateAll();}
  private restore(target:object,key:string,wrapper:unknown){if((target as Record<string,unknown>)[key]!==wrapper)return;const descriptor=this.descriptors[key];if(descriptor)Object.defineProperty(target,key,descriptor);else Reflect.deleteProperty(target,key);}
  clear(){
    if(!this.active)return;this.active=false;this.desired=[];this.signature=[];this.view.tree.clearSelectedDoms();this.view.tree.focusedItem=null;this.view.sort();this.view.tree.infinityScroll.invalidateAll();
  }
  dispose(){
    if(this.stopped)return;
    try{this.clear();}finally{
      this.stopped=true;
      this.restore(this.view,'getSortedFolderItems',this.sorted);this.restore(this.view,'getNodeId',this.nodeId);this.restore(this.view,'isItem',this.isItem);
      if(this.saveFolds)this.restore(this.view.tree,'saveFolds',this.saveFolds);
      if(this.requestFolds)this.restore(this.view.tree,'requestSaveFolds',this.requestFolds);
      this.controls.clear();
    }
  }
}
