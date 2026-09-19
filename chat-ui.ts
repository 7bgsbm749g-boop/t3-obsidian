import {App, FuzzySuggestModal, Modal, Notice, Setting} from 'obsidian';
import {projectKey, projectLabel, RequestDeliveryError, type Project} from './bridge';

export interface ChatHost {
  getProjects(): Project[];
  getPreferredProjectKey(): string | undefined;
  getReadinessError(): string | undefined;
  sendChat(prompt: string, project: Project): Promise<void>;
  openSettings(): void;
}

function availableProjects(host: ChatHost): Project[] | undefined {
  const error = host.getReadinessError();
  const projects = host.getProjects();
  if (error || !projects.length) {
    new Notice(error || 'Select a T3 project in Send to T3 Code settings before starting a chat.', 8000);
    host.openSettings();
    return undefined;
  }
  return projects;
}

function preferredProject(host: ChatHost, projects: Project[]): Project | undefined {
  return projects.find(project => projectKey(project) === host.getPreferredProjectKey())
    ?? (projects.length === 1 ? projects[0] : undefined);
}

function reportError(error: unknown) {
  new Notice(`T3 Chat: ${error instanceof Error ? error.message : String(error)}`, 10000);
}

class ChatProjectModal extends FuzzySuggestModal<Project> {
  private chosen = false;
  constructor(app: App, private projects: Project[], private choose: (project: Project) => void, private dismiss?: () => void) {
    super(app);
    this.setPlaceholder('Choose a project for this T3 chat');
    this.emptyStateText = 'No matching T3 projects.';
  }
  getItems() { return this.projects; }
  getItemText(project: Project) { return `${projectLabel(project)} — ${project.workspaceRoot}`; }
  onChooseItem(project: Project) {
    if (this.chosen) return;
    this.chosen = true;
    this.choose(project);
  }
  onClose() { super.onClose(); this.dismiss?.(); }
}

class ChatPromptModal extends Modal {
  private project: Project | undefined;
  private submitting = false;
  private picking = false;
  private prompt = '';
  private field!: HTMLTextAreaElement;
  private target!: Setting;
  private send!: Setting;

  constructor(app: App, private host: ChatHost, projects: Project[], prompt = '', project?: Project) {
    super(app);
    this.prompt = prompt;
    this.project = project ?? preferredProject(host, projects);
  }

  onOpen() {
    this.titleEl.setText('New T3 chat');
    this.contentEl.empty();
    this.field = this.contentEl.createEl('textarea', {
      attr: {'aria-label': 'Message for T3', placeholder: 'What would you like to do?', rows: '5'},
    });
    this.field.style.width = '100%';
    this.field.value = this.prompt;
    this.field.addEventListener('input', () => { this.prompt = this.field.value; });
    this.field.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.target = new Setting(this.contentEl).addButton(button => button.setButtonText('Choose project').onClick(() => {
      if (this.submitting || this.picking) return;
      const projects = availableProjects(this.host);
      if (!projects) return;
      this.picking = true;
      new ChatProjectModal(this.app, projects, project => {
        this.project = project;
        this.updateTarget();
        this.field.focus();
      }, () => { this.picking = false; }).open();
    }));
    this.updateTarget();
    this.send = new Setting(this.contentEl)
      .setDesc('Starts a new thread with this message. Ctrl/⌘ + Enter to send.')
      .addButton(button => button.setButtonText('Send').setCta().onClick(() => { void this.submit(); }));
    this.field.focus();
  }

  private updateTarget() {
    this.target.setName(this.project ? projectLabel(this.project) : 'Choose a T3 project');
    this.target.setDesc(this.project?.workspaceRoot ?? 'Your message will be sent to the project you select.');
  }

  private async submit() {
    if (this.submitting || this.picking || !this.field.value.trim()) return;
    const projects = availableProjects(this.host);
    if (!projects) return;
    const project = projects.find(item => this.project && projectKey(item) === projectKey(this.project));
    if (!project) {
      this.picking = true;
      new ChatProjectModal(this.app, projects, chosen => {
        this.picking = false;
        this.project = chosen;
        this.updateTarget();
        void this.submit();
      }, () => { this.picking = false; }).open();
      return;
    }
    this.submitting = true;
    this.field.disabled = true;
    this.send.setDisabled(true);
    this.target.setDisabled(true);
    try {
      await this.host.sendChat(this.field.value, project);
      this.close();
    } catch (error) {
      reportError(error);
      if(error instanceof RequestDeliveryError&&error.requestSaved){this.close();this.host.openSettings();}
    } finally {
      this.submitting = false;
      this.field.disabled = false;
      this.send.setDisabled(false);
      this.target.setDisabled(false);
    }
  }
}

/** A palette query goes straight to its target; a command opens the prompt editor. */
export function openChatFlow(app: App, host: ChatHost, prompt?: string): void {
  if (prompt !== undefined && !prompt.trim()) return;
  const projects = availableProjects(host);
  if (!projects) return;
  if (prompt === undefined) {
    new ChatPromptModal(app, host, projects).open();
    return;
  }
  let submitting = false;
  const send = async (project: Project) => {
    if (submitting) return;
    submitting = true;
    try { await host.sendChat(prompt, project); }
    catch (error) {
      reportError(error);
      if (error instanceof RequestDeliveryError && error.requestSaved) host.openSettings();
      else new ChatPromptModal(app, host, projects, prompt, project).open();
    }
  };
  const preferred = preferredProject(host, projects);
  if (preferred) void send(preferred);
  else new ChatProjectModal(app, projects, project => { void send(project); }).open();
}
