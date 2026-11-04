/** Mirror Obsidian's per-window DOM factories in the small native-host ports. */
export function installDomFactories(document:any){
 const win=document.defaultView??{};
 const createEl=(tag:string,options:any={})=>{const element=document.createElement(tag);if(typeof options==='string')element.className=options;else {if(options.cls)element.className=options.cls;if(options.text)element.textContent=options.text;for(const [key,value] of Object.entries(options.attr??{}))element.setAttribute(key,String(value));}return element;};
 Object.assign(win,{createEl,createDiv:(options?:any)=>createEl('div',options),createSpan:(options?:any)=>createEl('span',options),createSvg:(tag:string)=>document.createElementNS('http://www.w3.org/2000/svg',tag)});
 document.win=win;return document;
}
