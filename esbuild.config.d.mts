import type {Loader,Plugin} from 'esbuild';
export function desktopTimersPlugin():Plugin;
export const editorExternals:string[];
export const agentAssetLoaders:Record<string,Loader>;
