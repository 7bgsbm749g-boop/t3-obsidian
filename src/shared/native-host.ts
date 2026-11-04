import type {App,View,WorkspaceLeaf} from 'obsidian';

export interface NativeViewRegistry {
  getTypeByExtension?(extension:string):string|undefined;
  getViewCreatorByType?(type:string):((leaf:WorkspaceLeaf)=>View)|undefined;
  viewByType?:Record<string,((leaf:WorkspaceLeaf)=>View)|undefined>;
}
export interface NativeSwitcher {
  app:App;
  renderSuggestion(suggestion:{type?:string;file?:{path:string}},element:HTMLElement):unknown;
}
interface NativeHost {
  commands:{executeCommandById(id:string):boolean};
  viewRegistry?:NativeViewRegistry;
  internalPlugins?:{getPluginById?(id:string):{instance?:{QuickSwitcherModal?:{prototype:NativeSwitcher}}}|undefined};
}
/** These host adapters keep the existing optional capability checks. */
export function nativeHost(app:App):App&NativeHost{return app as App&NativeHost;}
