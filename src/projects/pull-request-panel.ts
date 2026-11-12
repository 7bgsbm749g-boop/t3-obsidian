import type {App} from 'obsidian';
import {NoteTabPanel} from '../notes/note-tab-panel';
import {isRecord,records} from '../shared/values';
import {displayText,panelLink,panelRow,safeWebLink,threadLink,type WorkspaceTarget,type WorkspaceData} from './workspace-panel';

export interface PullRequestData {detail:Record<string,unknown>;activity?:Record<string,unknown>;error?:string}
export class PullRequestPanel extends NoteTabPanel {
  private revision=0;
  constructor(app:App,private target:WorkspaceTarget,private load:()=>Promise<WorkspaceData>,private read:(link:Record<string,unknown>)=>Promise<PullRequestData>){super(app,target.notePath,'pull-requests');}
  onOpen(){this.titleEl.setText('Pull requests');this.modalEl.classList.add('t3-pull-request-panel');this.contentEl.empty();const revision=++this.revision;
    const status=this.contentEl.createEl('p',{text:'Reading linked pull requests…',attr:{role:'status'}});
    void this.load().then(async data=>{
      if(revision!==this.revision)return;status.remove();
      if(!data.pullRequests.length)this.contentEl.createEl('p',{text:'No pull requests are linked to this thread. Link a PR in T3 to show it here.'});
      for(const link of data.pullRequests.slice(0,10)){
        if(revision!==this.revision)return;const card=this.contentEl.createDiv({cls:'t3-pr-card'});
        try{const result=await this.read(link);if(revision!==this.revision)return;this.render(card,link,result);}
        catch(error){card.createEl('p',{text:error instanceof Error?error.message:displayText(error),attr:{role:'alert'}});const url=safeWebLink(link.url);if(url)panelLink(card,'Open pull request ↗',url);}
      }
      if(data.pullRequests.length>10)this.contentEl.createEl('p',{text:'Showing the first 10 linked pull requests.'});
      const footer=this.contentEl.createDiv({cls:'t3-panel-footer'});panelLink(footer,'Review and manage in T3 ↗',threadLink(this.target));footer.createEl('button',{text:'Refresh'}).addEventListener('click',()=>this.onOpen());
    }).catch(error=>{if(revision!==this.revision)return;status.setText(error instanceof Error?error.message:displayText(error));status.setAttribute('role','alert');this.contentEl.createEl('button',{text:'Retry'}).addEventListener('click',()=>this.onOpen());});
  }
  onClose(){this.revision++;}
  private render(card:HTMLElement,link:Record<string,unknown>,result:PullRequestData){
    const pr=result.detail;const state=pr.isDraft?'Draft':displayText(pr.state??'Unknown');
    card.createSpan({text:`#${displayText(link.number)} · ${state}`,cls:'t3-pr-state'});card.createEl('h2',{text:displayText(pr.title??'Pull request')});
    card.createEl('p',{text:`${displayText(pr.headBranch??'')} → ${displayText(pr.baseBranch??'')}`,cls:'t3-pr-branches'});
    const url=safeWebLink(pr.url??link.url);if(url)panelLink(card,'Open on host ↗',url);
    panelRow(card,`${displayText(pr.changedFiles??0)} files changed`,'file-diff',`+${displayText(pr.additions??0)} −${displayText(pr.deletions??0)}`);
    const tabs=card.createDiv({cls:'t3-pr-tabs'}),body=card.createDiv();
    const render=(tab:string)=>{
      body.empty();for(const button of Array.from(tabs.querySelectorAll('button')))button.setAttribute('aria-pressed',displayText(button.textContent===tab));
      if(tab==='Overview'){body.createEl('p',{text:displayText(pr.body??'No description.').slice(0,16000),cls:'t3-pr-description'});panelRow(body,'Mergeability','git-merge',displayText(pr.mergeability??'Unknown'));}
      if(tab==='Checks'){const checks=records(pr.checks);if(!checks.length)body.createEl('p',{text:'No checks reported.'});for(const check of checks)panelRow(body,displayText(check.name??'Check'),'circle-check',displayText(check.bucket??check.state??check.status??'Unknown'));}
      if(tab==='Activity'){if(result.error)body.createEl('p',{text:result.error,attr:{role:'alert'}});const comments=records(result.activity?.comments);if(!comments.length&&!result.error)body.createEl('p',{text:'No review activity.'});for(const comment of comments.slice(-30)){const row=body.createDiv({cls:'t3-pr-comment'});row.createEl('strong',{text:isRecord(comment.author)?displayText(comment.author.login??'Reviewer'):'Reviewer'});row.createEl('p',{text:displayText(comment.body??'').slice(0,8000)});}}
    };
    for(const label of ['Overview','Checks','Activity']){const button=tabs.createEl('button',{text:label});button.addEventListener('click',()=>render(label));}render('Overview');
  }
}
