import {MarkdownRenderChild,Modal,type App,type Plugin} from 'obsidian';
import {IMAGE_RESULT_LANGUAGE,parseImageResult,imageResultLabel} from './image-results';
import {ImageResultStore,ImageResultError} from './image-result-store';

/** The native code-block processor also handles callouts and Live Preview.
 * Each render child owns its object URL and ignores late network results. */
export function installImageResults(app:App,plugin:Plugin,store:ImageResultStore){
  plugin.register(()=>store.dispose());
  plugin.registerMarkdownCodeBlockProcessor(IMAGE_RESULT_LANGUAGE,(source,el,ctx)=>{
    const reference=parseImageResult(source);
    if(!reference){el.createEl('p',{text:'Invalid T3 image reference.'});return;}
    el.addClass('send-to-t3-image-result');
    const child=new MarkdownRenderChild(el);ctx.addChild(child);
    let disposed=false,loading=false,url:string|undefined;
    let eviction=Promise.resolve();
    const urls=el.ownerDocument.defaultView!.URL;
    child.register(()=>{disposed=true;if(url)urls.revokeObjectURL(url);});
    const failure=(error:unknown)=>{
      if(disposed)return;
      el.empty();el.createEl('p',{text:error instanceof ImageResultError?error.message:'Cannot load the image. Check your T3 connection, then retry.'});
      const retry=el.createEl('button',{text:'Retry image'});retry.addEventListener('click',()=>{void load();});
    };
    const load=async()=>{
      if(disposed||loading)return;
      loading=true;el.empty();el.createEl('p',{text:'Loading image…'});
      try{
        await eviction;if(disposed)return;
        const result=await store.get(reference);if(disposed)return;
        url=urls.createObjectURL(new Blob([result.bytes],{type:result.mimeType}));
        const displayedUrl=url;
        el.empty();const button=el.createEl('button',{cls:'send-to-t3-image-open',attr:{'aria-label':'Open '+imageResultLabel(reference)}});
        const image=button.createEl('img',{attr:{src:url,alt:imageResultLabel(reference)}});
        image.addEventListener('error',()=>{
          if(disposed||url!==displayedUrl)return;
          urls.revokeObjectURL(displayedUrl);url=undefined;
          eviction=store.invalidate(reference).catch(()=>{/* The store also rejects these cached bytes in memory. */});
          failure(new ImageResultError('decode'));
        });
        button.addEventListener('click',()=>{
          if(!url||disposed)return;
          const modal=new Modal(app);modal.setTitle(imageResultLabel(reference));
          modal.contentEl.createEl('img',{cls:'send-to-t3-image-expanded',attr:{src:url,alt:imageResultLabel(reference)}});
          child.register(()=>modal.close());modal.open();
        });
      }catch(error){
        failure(error);
      }finally{loading=false;}
    };
    void load();
  });
}
