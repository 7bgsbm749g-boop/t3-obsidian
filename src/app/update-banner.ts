import type {UpdateState} from './plugin-updates';

/** A non-modal notification at the top of the main workspace. */
export class UpdateBanner {
  private element?:HTMLElement;
  constructor(private container:HTMLElement,private update:()=>void,private dismiss:()=>void){}
  render(state:UpdateState|null){
    this.element?.remove();this.element=undefined;if(!state)return;
    const doc=this.container.ownerDocument,element=doc.win.createDiv();element.className='t3-update-banner';element.setAttribute('role','region');element.setAttribute('aria-label','T3 Code update');
    const text=doc.win.createSpan();text.className='t3-update-banner-message';text.setAttribute('role','status');text.textContent=state.message;element.append(text);
    const actions=doc.win.createDiv();actions.className='t3-update-banner-actions';element.append(actions);
    const update=doc.win.createEl('button');update.textContent=state.busy?'Updating…':'Update';update.className='mod-cta';update.disabled=state.busy;update.addEventListener('click',this.update);actions.append(update);
    const dismiss=doc.win.createEl('button');dismiss.textContent='Dismiss';dismiss.disabled=state.busy;dismiss.addEventListener('click',this.dismiss);actions.append(dismiss);
    this.container.prepend(element);this.element=element;
  }
  dispose(){this.render(null);}
}
