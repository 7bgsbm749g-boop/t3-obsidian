import {setIcon} from 'obsidian';
import {subagentProviderIcon} from '../responses/subagent-provider-icon';

/** Render only our bundled T3 glyph paths, never provider-supplied markup. */
export function setComposerProviderIcon(element:HTMLElement,driver?:string){
  element.empty();
  const markup=subagentProviderIcon(driver),viewBox=markup.match(/viewBox="([^"]+)"/)?.[1],path=markup.match(/ d="([^"]+)"/)?.[1];
  if(!viewBox||!path){setIcon(element,'bot');return;}
  const svg=element.createSvg('svg',{attr:{viewBox,'aria-hidden':'true',fill:'currentColor'}});
  svg.createSvg('path',{attr:{d:path,'fill-rule':'evenodd','clip-rule':'evenodd'}});
}
