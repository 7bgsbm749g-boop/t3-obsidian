# Send to T3 Code

One Obsidian plugin for desktop and mobile. Chat from the command palette, send a Markdown note to a T3 project, or create a folder workflow. Linked folders choose the destination for notes below them. Manual sends preserve Markdown and embedded images.

## Folder workflows and event capture

Link a folder to a T3 project, then long press or right-click it and choose **Setup T3 workflow → Setup new workflow…**. Describe when the workflow should run and what it should do. Creating it starts a T3 thread showing your description and a short pointer to temporary setup instructions under `.obsidian/t3-code/setup/`. The agent reads those instructions and writes a JSON setup result there; the coordinator validates its trigger, scope, and task, saves the enabled workflow, and removes both temporary files. Keep the coordinator's Obsidian client open for setup and workflow execution.

To change an existing workflow, open it from the same folder menu. The edit box starts empty. **Save changes** sends your request as a new turn in the original setup thread; normal workflow runs continue in their own threads. The current workflow remains active until the coordinator validates and activates the proposed revision. If a change request is unresolved, cancel it from the edit dialog before sending another.

With no enabled workflows, the plugin does not record or publish observations. It removes the old visible `T3 Automation` and `T3 Workflow Setup` folders after loading, including copies returned through Sync. Each enabled workflow subscribes to only its selected event types and folder scope. The engine seeds note baselines silently so a later update has a known previous state. Pausing or removing the last workflow stops capture. Changing subscriptions starts a new stream, so old unpublished observations cannot be released later.

For captured saved revisions, immutable JSON records under `.obsidian/t3-code/automation/` include exact line changes and relevant metadata. These files stay outside the visible vault tree and Obsidian Sync; paired mobile clients send them directly to the coordinator through the authenticated T3 connection. Records can contain private note text. The coordinator validates the records, runs matching workflows, and answers bounded event-history queries. A workflow action receives query instructions only when its definition requests history access. That agent may request history for the event types and paths a workflow records; events outside those subscriptions do not exist in the journal.

Workflows start paused by default. Enabling one does not run it against existing notes. The coordinator records matching future events, waits through the debounce period, persists a run plan, and sends it to the linked T3 project. Recent run states and uncertain delivery retries appear in settings. A changed input note or folder destination stops delivery for review.

## Setup: desktop and mobile

1. Install and run T3 Code on your computers. Sign in to the same T3 account and enable **T3 Connect** on each destination. T3 supplies the public HTTPS connection; no Tailscale or plugin companion is required. See [T3 remote access](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md).
2. Install `main.js` and `manifest.json` in `<vault>/.obsidian/plugins/send-to-t3-code/` and enable the plugin.
3. In **Settings → Send to T3 Code**, keep **T3 Connect (recommended)** selected. Enter your T3 account email and click **Send sign-in code**.
4. Enter the six-digit code from T3’s email and click **Verify and connect**. The plugin discovers your account’s computers, authorizes each online connection and scans its projects automatically. No terminal commands, machine URLs, pairing links or per-machine codes are needed.
5. Enable the projects you want in the note menu. Their names include the destination computer. On mobile, use the note menu → **Open in T3 Code**, or the command palette’s **Send to T3 Code** row.

Sign in once on each device. Project choices, connection names, and folder links sync, but account credentials do not. Until this device is signed in and its machine/project discovery completes, the settings page shows only the sign-in or connection-progress screen. Projects, computers, orchestration, folder links, manual pairing, and saved-request controls remain hidden so synced names cannot be mistaken for a live connection. **Refresh connections** retries discovery and authorization. The plugin refreshes connections after reopening Obsidian and renews account-managed sessions before they expire when used. This never resends notes or queues work.

This is an independent integration with T3’s existing native authentication and relay APIs. Email verification uses T3’s Clerk native frontend API, enabled by T3, and its `t3-relay` token template. The relay accepts that credential and issues device-bound connection grants. The plugin requests only environment thread read/operate scopes. It does not read installed T3 credentials or browser cookies, impersonate an existing device session, register a replacement `t3code://` handler, or need access to your email inbox. It does not collect your T3 password or create a new T3 account.

Account/session tokens stay in device-local, vault-specific Obsidian storage and are not OS-keychain encrypted. The device’s non-extractable DPoP signing key stays in local IndexedDB. Neither is written to the synced vault. Email verification codes are not retained. **Sign out** removes account credentials and account-managed environment sessions on this device, and asks T3 to revoke this sign-in session. Independently paired manual connections are retained. If revocation cannot reach T3, the plugin reports that local sign-out succeeded and directs you to T3’s account controls for remote revocation. A cancelled or expired sign-in does not restore account access later.

Sources: [T3 relay authorization](https://github.com/pingdotgg/t3code/blob/main/infra/relay/src/http/Api.ts), [T3 managed account authentication](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/cloud/managedAuth.tsx), [Clerk email-code sign-in](https://clerk.com/docs/guides/development/custom-flows/authentication/email-sms-otp), and [Clerk native API behavior](https://clerk.com/docs/guides/development/errors/frontend-api).

### Advanced: manual pairing

After account connection finishes, existing manual pairings still work. Expand **Advanced: manual pairing** to use a known HTTPS environment address and a fresh T3 pairing code or link. A hosted `https://app.t3.codes/pair?host=…#token=…` link is accepted. Manual pairing is available without account sign-in. Each device pairs separately; manual sessions require pairing again after their displayed expiry. Re-pairing preserves selections and pending requests.

T3’s Connections page currently hides its pairing controls when Network access and Tailscale HTTPS are both off, even when T3 Connect is enabled. In that case the official `t3 auth pairing create --ttl 10m --label Obsidian --json` command on the destination can issue a code without changing its network settings. This command is **not needed for the recommended account setup**.

Manual pairing exchanges a one-time code for a scoped bearer session. The code is discarded, and the session remains only on this device. **Forget pairing** removes the local credential; revoke its client session in T3 Settings → Connections to revoke server access. Remote connections require HTTPS and refuse redirects; HTTP is allowed only for loopback testing.

### Advanced: this computer only

Desktop users can choose **This computer only (advanced)** to use local T3 without account sign-in. Install T3 and its matching official CLI. The plugin discovers the CLI in standard locations or PATH; executable and data-directory overrides are available if needed. Scan projects and select the ones you want. The CLI issues five-minute sessions for T3’s authenticated loopback API, which the plugin revokes after each operation. No shell interpolation, Python or Fleet adapter is used. This option is unavailable on mobile.

The destination must remain online. There is no offline queue or automatic resend. An interrupted send is saved for **manual Retry** with its exact original commands, preventing duplicate threads after a lost response. Completion monitoring uses the same connection while Obsidian is active.

New threads use the selected machine's T3 model defaults: an explicit project override takes precedence over the environment default. Configured model options, including reasoning effort, are preserved; previous threads do not supply the model or reasoning settings. If T3 is set to automatic selection, the plugin uses an enabled provider's advertised default model. Existing-thread sends retain that conversation's model. Saved retries replay their original model and commands even if defaults have since changed.

## What belongs to T3, and what belongs to this plugin?

| Component | Owner |
| --- | --- |
| Projects, threads, model execution, image attachments and turn status | T3 Code |
| Pairing codes, scoped sessions and orchestration HTTP endpoints | T3 Code |
| T3 Connect account, native email verification, managed HTTPS tunnel, discovery and device-bound grants | T3 Code |
| Obsidian sign-in UI, automatic connection/renewal client, project menu, image extraction and completion actions | This plugin |
| Old HTTPS companion and its SSH/Python forwarding | Custom component removed in 2.1 |
| Fleet adapter and persistent delivery queue | Not used by this plugin |

```mermaid
flowchart LR
  O[Obsidian desktop or mobile] -->|Email verification| A[T3 account / Clerk]
  A -->|Account token| O
  O -->|Authorize owned machines| R[T3 Connect relay]
  R -->|Device-bound grants| O
  O -->|Scoped DPoP session over HTTPS| T[T3 environment]
  R -. Managed public tunnel .-> T
  T --> P[Selected project]
  P --> N[New thread with note and images]
  T -->|Turn status| O
```

Account connections and manual pairing use T3's existing protocols, not an official Obsidian SDK or a guarantee of long-term API stability. Sources: [T3 auth endpoints](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/auth/http.ts), [remote client implementation](https://github.com/pingdotgg/t3code/blob/main/packages/client-runtime/src/authorization/remote.ts), and [pairing URL construction](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/settings/pairingUrls.ts).

## Upgrade

Install the newest release and reload the plugin on each device after Sync finishes. Existing manual connections, project selections, and folder links remain. Previous v1 workflow and tag trigger definitions are no longer loaded or shown. Each device clearly requires its own email verification before synced projects and folder links become visible. The old HTTPS companion mode and bundled Python/SSH code are removed. Devices previously using that mode now open **T3 Connect** and can use the account setup above. Old service URLs, keys and remote project catalogs are removed from the active settings. Local desktop settings and direct connections remain available.

Old unconfirmed sends remain visible for review but cannot be retried through the removed mode. Check the original thread in T3 before creating another send, since the earlier request may have started. Discard only removes the local retry record. Old companion completion jobs keep their notes and stop monitoring. Direct/local completion monitoring continues. No request is automatically rerouted or sent during migration.

The obsolete companion service is no longer part of the plugin. Its operator can stop/remove it after upgrading their clients. Historical state backups may be retained privately, but neither companion nor queue files are read by this plugin.

## Command palette

Open Obsidian’s command palette (Ctrl/⌘ + P, or your configured mobile swipe-down action). Its first T3 Code row changes with the editor selection and palette input:

| Selection | Typed input | First row | Sent to T3 |
| --- | --- | --- | --- |
| None | None | **Send to T3 Code** | Full Markdown note and embedded images |
| Text | None | **Ask T3 Code** | Selected text, its embedded images, and note location |
| None | Text | **T3 Code: “…”** | Typed question and note location |
| Text | Text | **Ask T3 Code: “…”** | Selected text, its embedded images, typed question, and note location |

The palette keeps one device-local draft. A confirmed question clears it. Sending uses the same note/image packaging as **Open in T3 Code** in the Files sidebar; asking does not copy the full note. All send and ask dialogs use the same compact layout. **Previous thread** defaults to the last thread used for this note; **New thread**, **Existing thread…**, and **Previous threads…** offer alternatives. Pressing Enter chooses the purple default button. Click the project-name button to select a project for this send. Its tooltip includes the source note path. For notes without an explicit parent-folder link, the default is **New project: <containing folder name>**, followed by **Vault project: <vault project name>** in the project selector. Opening or cancelling the dialog does not create a project or link. Choosing the vault project leaves the folder unlinked. A manual message ends with **Sent from Obsidian.**, the vault name, and the destination note path. No vault-relative path line is sent.

The nearest explicitly linked folder supplies the destination, including for notes in subfolders. An unlinked note inside a folder defaults to creating or reusing a T3 project for that folder on the vault project machine, named after the folder. A confirmed send saves its self-link; failed delivery retains the intended link with the saved retry. Existing note-thread history continues to supply the previous-thread default. Root-level notes and chat with no Markdown note open use the vault-root link. If that association is missing or its project is no longer discovered, mobile opens **Connect vault** and keeps the original prompt ready. On desktop, connected machines offer the same chooser with **This computer** as an additional option; without remote connections, the plugin can still discover or create the local vault project automatically using the official T3 CLI.

Manage the default under **Settings → Send to T3 Code → Orchestration → Vault project machine → Connect vault / Change machine**. Choose any machine discovered through your T3 account or manual pairing, then select **Find vault**. The plugin checks remembered locations and registered projects for this vault's synced identity. Select a matching folder, or use the remote folder browser to find its existing synced copy. **Use this folder** verifies the identity, reuses or creates a project on that machine, saves the association, and resumes the original chat action. Cancelling setup leaves the prompt open. An offline machine leaves setup open for retry or another choice.

Vault identity, known machine locations, and the chosen root association sync in plugin settings; session credentials and unfinished project-registration commands remain device-local. Enable community-plugin settings in Obsidian Sync on both devices. A matching name alone never connects a folder: different local vault names are fine, but the synced identity must match. Thread-only sends can use headless Sync without desktop Obsidian. Streaming replies into notes requires Obsidian with this plugin running on the vault project machine; the destination note can remain closed. The selected computer must already have a synced copy; this feature neither provisions a new Sync account nor uploads a replacement vault.

Newly connected remote vaults check that the referenced note appears in the destination folder before sending, briefly waiting for Obsidian Sync if it is missing. This checks file presence, not whether every edit or attachment has finished syncing. Local desktop sends use the absolute note path. Self-linked remote folders use their project root, while other remote folder links use a root link on the same connection as the destination-vault mapping. If no safe destination path can be found, the footer says **(unmapped on destination)** rather than inventing a filesystem path.

The live row uses isolated, version-checked internal command-palette methods because Obsidian does not expose a public dynamic-result API; keep the core Command palette plugin enabled. The note context is captured when the destination dialog opens. Switching notes while choosing a thread does not change that context.

Questions retain the optional wait instruction, 120,000-character limit (including note context), and manual retry handling. They never enroll the note for archive/delete cleanup. An unconfirmed send must be retried through **Unconfirmed requests → Retry**, which preserves the original prompt, note path, destination, and command IDs.

## Inline responses

Under **Settings → Send to T3 Code → Inline responses**, **Stream replies into the editor** is on by default for all manual Send and Ask actions. The sending device writes new replies directly into its local note. The **Vault project machine** coordinates exclusive ownership, even when a folder link sends the T3 thread to a different machine. Turning streaming off keeps answers in T3 threads.

Manually sending a note with **Open in T3 Code** or palette **Send to T3 Code** appends a streamed reply at the end of that note. A typed palette question also appends its reply at the end. The plugin opens the note in a Markdown tab if needed. A full-note send captures its content before inserting the response and sends that content and its images to T3. A streamed note stays in place even if archive or delete is selected under **When task completes**. Folder workflows do not stream into the editor. Changing the switch affects new sends; an already active response continues to completion or until stopped.

## Ask T3 inline

While a response is running, use **Ask T3 Code** on selected text or type a question in the command palette and choose **Send to running thread**. The plugin sends it to that response’s existing T3 thread and keeps writing in the same response block. Your input appears as a neutral indented **You** quote between the agent’s paragraphs. Selected text moves from its original location only after T3 confirms the message; typed palette input is inserted directly. If the selection changed in the meantime, its edited source text is preserved. Select your input outside the running response, or type it in the palette.

Steered responses retain the assistant paragraphs around your messages, including when **Keep intermediate agent responses** is off. Input positions, exact message IDs, and the transcript survive reconnects, plugin reloads, and writer handoffs. Any authenticated device can send without taking ownership of the writer. Hash checks still protect the response from manual edits. Saved delivery failures use **Unconfirmed requests → Retry** with the original IDs; the plugin never automatically resends input. If the original turn finishes after steering is reserved, a resulting new turn is explicitly attached to the same response. If the response has already finalized or is paused before reservation, the send is refused. Pending approvals and structured questions must be answered before ordinary steering.

Select text in a Markdown editor and choose **Ask T3 Code** from the editor menu, or use the palette’s **Ask T3 Code** row. Choose **New thread** or **Existing thread…**. The plugin sends the selection, its embedded images, and destination note path to T3, then inserts a tracked response below the selected line. Add text in the palette to send a specific question about the selection. The response shows **T3 · Working** from initial submission through streaming, without a separate sending label. A working indicator animates while the reply streams. Routine tool activity stays in T3; approval and question prompts still appear in the note and through an Obsidian notice. When the turn completes, the plugin replaces progress text with only the final answer by default. Enable **Keep intermediate agent responses** under **Inline responses** to retain the agent’s progress paragraphs alongside the final answer. This choice applies to new responses and stays with each response through reloads and device handoffs; routine tool activity and status indicators are still removed. The plugin owns the note insertion.

When T3 asks for input, the question text and option descriptions appear beneath the streamed progress in the same purple quote. **Answer** opens an Obsidian dialog in Live Preview or Reading view; **Answer T3 question…** also appears in the editor menu and command palette. The dialog supports single choice, multiple choice, free text, and several questions in one request. Incoming questions never open it automatically. Streaming refreshes preserve the draft, focus, and text selection. Closing the dialog saves the draft without answering or dismissing. Only **Submit answer** sends a response; a preselected choice alone never sends.

Blocking questions wait for an answer. Async questions show **Question pending** and can remain open after the final response removes its streaming markers. Only async questions offer **Dismiss**, which closes the request without messaging the agent. Once T3 confirms resolution, the answer dialog closes with a brief notice; a dispatch acknowledgement alone does not close it. The note stays ordinary readable Markdown. Once answered, the controls and question tracking comments disappear; the completed question text is preserved.

Continuing a failed response keeps its earlier progress visible alongside the explicitly attached new turn. With **Keep intermediate agent responses** enabled, that entire transcript remains after completion. Steering uses the same transcript, so adding a steering message or answering a question does not swap the visible history. Existing checkpoints from older versions recover their adopted continuation turn when the writer resumes.

Any device viewing the synced question can answer using its own authenticated connection to the original T3 machine, regardless of which device owns streaming. The plugin refreshes authoritative request state before submitting, preserves native question IDs and option values, and waits for T3’s resolution before clearing controls. An answer in T3 or another Obsidian client clears them here too. Drafts and exact pending commands remain device-local. If the connection drops during submission, reopen **Answer** and use **Retry saved answer** to retry the original command safely. Provider failures retain the draft. Existing local and hosted responses use the same question model.

With editor streaming off, the same question and note path are sent, and T3 answers in its thread without the plugin adding a response to the note. Send instructions ask T3 to answer in its thread and, when streaming, explain that the plugin inserts the reply. They do not prohibit note edits requested by the user.

On mobile, selecting text in the Markdown editor shows a small **Ask T3 Code** button above the selection. Tap it to open the same thread chooser; no mobile toolbar setup is needed. The button disappears when the selection is cleared or another note becomes active. The iOS Cut/Copy/Paste menu itself cannot host plugin actions.

The response is surrounded by small HTML comment markers so it can be found after edits elsewhere in the note, file/view switches, or a plugin reload. Obsidian hides these tracking lines in its editor; they remain in the raw Markdown for safe updates and may be visible in other text editors. The owning device replaces only the marked response and preserves surrounding text. It remembers generated versions so an older generated block arriving through Sync can catch up. Unrecognized edits or removal of the response stop writing and preserve your changes; the answer remains available in T3. Replies update the live editor when open, or the vault file when closed. Each write rechecks ownership and current note contents. Replies started under the previous host-only implementation still finish on their original host; older device-local replies retain their original behavior. Prose remains in a blockquote; headings, top-level tables and fenced code blocks render outside it so they work in Live Preview. A partial table moves out of the quote when its delimiter row arrives, and an open code fence is temporarily closed while streaming. Selecting text inside a fenced block places the response after the closing fence; an unclosed fence must be closed first.

Disconnected responses reconnect automatically once their T3 connection and vault host are available again. The saved user-message ID keeps recovery tied to the original response even if you continue chatting in T3 before Obsidian reconnects. When the original turn has fallen outside the recent 20-turn polling window, the plugin reads the complete canonical history and recovers only an unambiguous original turn. Completed historical responses use their durable completion checkpoint and final message ID. Projects without Git checkpoints can also finish recovery when the complete canonical transcript shows finalized assistant messages before a newer user-anchored turn. A newer running turn does not leave an older answer stuck on Working. Recovery uses the existing request and response block; it never sends another prompt. Ambiguous history remains tracked for a later retry, and edits inside the response remain protected.

If T3 fails a turn, the tracked response shows the reason reported by T3, including a usage-limit message when T3 provides one. It remains recoverable. In the editor menu, **Continue T3 response** sends exactly `Continue.` as one new turn in the same thread and streams its answer into the existing response with one click. **Attach latest T3 continuation** binds a newer turn already started in T3, after checking that its user message belongs to the same thread. If the note moved, either action can recover the response when its original path is gone and the block still matches a version the plugin wrote. Neither action replaces a response block you edited. A lost send acknowledgement still uses **Unconfirmed requests → Retry** with the original request ID; it does not create another continuation. If T3 resumes the original turn after a server restart, that turn can finish in place without a new message. The plugin does not repeatedly send requests while a provider limit is active.

At turn completion, the owning device imports local image and file references from the retained assistant Markdown (the final answer by default, plus intermediate responses when enabled). It uses T3's signed file URL for previewable files and its project reader for text files, saves deterministic copies under `T3 Code Attachments/<response-id>/`, and replaces each reference with an Obsidian link at its original position. Existing vault files are linked directly. External web links and examples inside code remain unchanged. If a file cannot be imported, the response remains tracked and its owner retries. Downloads have a 30-second timeout. Other remote binary file types need an upstream file download route before they can be imported.

Streamed updates preserve the editor's reading position rather than scrolling to the cursor. An active response offers **Stop T3 response** in the editor menu, which requests an interrupt for that T3 turn. Once stopped, the partial answer and stopped status remain as ordinary Markdown; both tracking tags are removed and the Stop action disappears. Respond to approval prompts in the T3 app. Questions can be answered directly in Obsidian as described below. Full reasoning traces and tool payloads are not copied into the note. Before dispatch, the sending device registers its response through the existing authenticated T3 connection. This does not wait for the note or response marker to sync to the VPS. The device receives T3 updates directly and writes the actual Markdown locally; there is no separate response display.

Ownership lasts 15 seconds and renews with a heartbeat every 3 seconds. Only missed heartbeats allow another connected Obsidian instance to take over. Hiding the app, switching notes, closing the plugin, or a visibility notification does not release ownership. If mobile timers keep running in the background, the phone keeps ownership. If they stop, another instance with the synced response marker can claim after expiry. Clients with the note open get a short head start over closed-note fallback writers. A returning sender must acquire a fresh grant before writing again. When no eligible client is active, the T3 run continues and its response catches up later. The device that owns the reply gets direct updates; other devices still receive note changes through Sync.

For threads on a connected remote computer, the writing device does not need its own T3 Code app or local server running. Obsidian and this plugin must remain active, and the thread machine and vault project coordinator must remain reachable. Local-only threads still require their local T3 server. These requirements also apply to question controls and continuation actions.

The vault project machine must keep Obsidian and this plugin running to grant ownership and accept heartbeats. It stores requests, ownership epochs, and known response versions under `.obsidian/t3-code/inline/v1/` (or the configured settings directory). Clients reach these files directly through T3; they contain no credentials and are not carried through Sync. A filesystem lock admits one coordinator, which serializes claims. Each writer checks a conservative local deadline immediately before note mutations, and checkpoints generated versions before inserting them. A completed editor reply stays recoverable until Obsidian has saved its final Markdown to disk. Independent jobs and heartbeats keep slow threads or downloads from blocking other notes. Unchanged progress does not rewrite the note. A lost coordinator connection stops writes once the grant expires; it cannot authorize a second writer offline.

The send modal closes immediately while delivery continues in the background. Validation failures reopen the draft; saved delivery failures show a notice without taking over the editor. If registration fails, the request stays in **Unconfirmed requests** for explicit retry with the same IDs. Install/reload the updated plugin on the vault project machine and each device that should participate. Changing the default machine affects new jobs; existing jobs retain their original coordinator.

The editor menu can request **Stop T3 response** from a synced device. Existing jobs created by older plugin versions keep their original device-local writer and must be stopped there. If you edit an actively streamed response in its open editor, that editor pauses writes. Undoing until both tracking markers and the response body match any version the plugin wrote lets the same editor catch up automatically from T3; edits elsewhere in the note are preserved. An unmatched response is never overwritten. This undo behavior does not make a paused response available for device takeover or restore it after the plugin restarts. Remove abandoned response markers/block before starting another inline response in that note.

## Orchestration

Settings → Send to T3 Code → **Orchestration → Wait for other threads** is off by default. Enable it to prepend this instruction to each new note or chat prompt:

> Before starting work on the task below, wait for all other active T3 Code threads in this project to finish. Exclude this thread and threads in other projects. Check their status periodically, and begin work only when no other threads in this project are active. If you cannot check thread status, ask the user before proceeding.

The setting persists per vault. This is an instruction to the receiving agent; the plugin does not enforce a project lock or wait before delivery. There is no delivery queue. It requires the agent to be able to check T3 thread status. The remaining note content and image references are unchanged. Retries use the originally saved prompt, even if this setting changes afterward.

## Folder links

Right-click a folder and choose **Link to T3 Code → Link to <project>**. Confirm the link in the dialog. Links appear under **Settings → Send to T3 Code → Linked folders** and route manual chat and note sends. Saving a link alone does not send notes.

**Link to self** is available on desktop and mobile. It registers the folder’s copy on the vault project machine as a T3 project, reusing an existing project for that exact workspace path. Local desktop registration uses the official `t3 project add` command with arguments passed directly to the executable without a shell. Remote registration verifies this vault’s synced identity and the folder’s destination path through the authenticated T3 connection. Mobile never uses its private filesystem path as a remote workspace. The resulting link is saved when you confirm the link dialog. Automatic note sends save their folder link only after delivery is confirmed.

Folder links sync with the vault. T3 credentials remain device-local. Each explicitly linked folder shows the **T3 logo followed by its linked project name** beside the folder name in the Files explorer on desktop and mobile. A folder with configured workflows but no explicit folder link shows only the T3 logo—never the inherited vault/project name. Any folder with workflows gives its logo a subtle turquoise glow. Other descendants remain unmarked. Long project names truncate to fit the sidebar, with the full name available in the tooltip and accessibility label. The indicator updates when links or workflows are added, removed, renamed, or synced.

### Sending notes into linked projects

**Open in T3 Code** opens the same compact project/thread destination dialog on desktop and mobile, with **New thread** and **Existing thread…** choices. The existing-thread option loads a searchable list of that project’s unarchived threads, newest first, with each thread labelled **Active** or **Idle**. Nested links take precedence. The command palette uses the same compact dialog for every note. Browsing existing threads for a new folder project does not create it; if no project exists yet, use New thread. A missing linked project reports an error instead of rerouting the note.

### Previous thread and note history

After every confirmed manual Send or Ask, the plugin remembers that thread as the note’s default for its next send. **Previous thread** means the last thread used from this note. This happens automatically, including when choosing a new or existing thread; there is no remembering toggle in the dialog or settings. An unconfirmed send does not change the default. **Previous threads…** offers older recorded destinations.

Thread history syncs in plugin settings and contains note paths, project destinations, and thread IDs, but no note body or credentials. Renaming a note moves its history; deleting it retires the records. The previous thread must still exist in its original T3 project. If that project is unavailable, the plugin reports the problem instead of rerouting the send. Notes are kept when a manual send completes.

Existing history and requests saved under the former note-thread-link terminology remain usable. Older sends without a unique recorded note path cannot be identified reliably by title alone. The plugin recovers a remembered destination from a confirmed completion job when its note and project still exist. Folder linking remains separate and continues to supply the default project.

Both choices send the full Markdown and embedded images. Existing-thread sends preserve its model, runtime permissions and interaction mode. An idle thread starts another turn; a running thread receives input through T3’s steering behavior. Resolve pending approvals or structured input in T3 before sending another note. Retries reuse the original thread and message IDs without creating a new thread. Every confirmed manual note send keeps the note and supersedes any older cleanup job for it.

**Settings → Send to T3 Code → Threads → Settle completed threads** is on by default. After a successful Obsidian turn, the plugin moves its T3 thread from the active list to the Settled shelf. A streamed answer must finish saving into its note first. Checks run every 30 seconds while the sending Obsidian client is open and resume after a restart. Pending approval, requested input, live background work, failed or interrupted turns, and turns superseded by later activity do not trigger settlement. Only threads sent by this plugin are affected. A later send to the same settled thread automatically wakes it and preserves the note’s remembered destination. Turning the setting off cancels pending settle checks; later sends remain active. Settling does not archive or delete the thread.

### Folder workflows

Right-click or long press a linked folder and choose **Setup T3 workflow**. The submenu lists workflows in that folder and offers **Setup new workflow…**. See [Folder workflows and event capture](#folder-workflows-and-event-capture) for capture and execution behavior.

## When task completes

Manual sends always keep their note because each confirmed thread becomes its next default destination. The **Orchestration → When task completes** settings remain available for previously queued cleanup jobs: **Keep note** (default), **Archive note**, or **Delete note (vault trash)**. Archive has a configurable vault-relative folder, defaulting to `Archive/T3 Code`; it preserves the note’s original subfolders and adds a numeric suffix if a destination already exists. Delete moves only the Markdown note to this vault’s `.trash`; embedded image files remain in place.

The plugin polls the destination T3 environment every 30 seconds while Obsidian is active. Mobile can suspend the app; checks resume when reopened. The completion signal is the original sent turn reporting `completed`, with its session idle (ready or stopped), no pending approval/input, and its original user message and final assistant message verified. This is a T3 lifecycle signal, not a judgment that the answer fully solved the task. Failed/interrupted turns and conversations that have advanced to additional turns keep the note.

The completion action and note fingerprint are saved when sending. Later setting changes affect new sends only; retries preserve the original action. Monitoring resumes after Obsidian restarts and retries connection errors. **Task completion monitoring** shows status and offers **Check now**, **Stop monitoring**, and **Dismiss**. Starting a newer send for the same note supersedes its previous cleanup action once that send is confirmed.

Notes edited, replaced, renamed, or left with unsaved editor changes are kept. Archive/delete runs in the sending Obsidian vault, including when the T3 thread runs on another computer. Existing notes and previously sent threads are not automatically enrolled.

## Embedded images

Full-note sends and Ask T3 questions use the same image packaging. Only images embedded in the selected passage or question are attached; unselected note content is not sent.

Supported embeds: `![[image.png]]`, `![[folder/image.png|300]]`, `![alt](relative/image.png)`, reference-style Markdown images, HTTPS image URLs, and base64 image data URLs. Local links use Obsidian’s resolver relative to the source note, including attachment folders and percent-encoded paths. Images inside code blocks, inline code, frontmatter, and escaped wiki embeds are ignored.

PNG, JPEG, GIF, and WebP bytes are uploaded through T3’s native attachment API. Each original embed is replaced by a native `t3-context://` reference, so the image stays at that point in the message. Repeated images reuse one attachment; all other Markdown is unchanged. Neither the note nor its images are moved or modified in the vault. HTTPS downloads use Obsidian’s `requestUrl` with no access key or authorization headers added. Mobile downloads are buffered by Obsidian before the byte limit can be checked; for large remote images, download a resized copy into the vault first.

Limits: 8 distinct images, 10 MiB per image, 20 MiB combined, and T3’s 120,000-character prompt limit. Missing images, failed downloads, HTML `<img>` embeds, unsupported formats such as SVG/HEIC, and limit violations stop the send with an error instead of silently omitting images. Convert unsupported formats to PNG/JPEG first. Non-image wiki transclusions (notes/PDF/audio) remain as Markdown and are not expanded. Image-only notes work.

The plugin includes image support. The selected T3 model/provider must accept image input. Direct pairing is verified against T3 0.0.43-nightly.20260917.1866; local integration was also tested against 0.0.43-nightly.20260916.1811; recheck compatibility after T3 upgrades.

## Empty states and recovery

Empty notes are rejected without creating a thread. Unlinked note sends offer a new containing-folder project and the vault project even when no projects are selected in settings. Linked-folder sends and palette chat use their folder/root association independently of the project-menu selection toggles. Failed scans report the error and preserve the last discovered list; unavailable selections are retained for later rediscovery. Sending to a removed project reports an error without scheduling delivery.

A request is saved before dispatch. During sending, additional sends are disabled. If a response is lost or fails, **Unconfirmed requests** in settings offers **Retry** using the exact original content, connection, and request ID. Do this instead of clicking New thread again, which intentionally creates a separate request. **Discard** removes only saved local retry data; it does not cancel or delete any T3 thread. Restarting Obsidian does not resend anything automatically.

Pending requests store the full note and base64 image bytes in local IndexedDB until confirmed/discarded. Direct mode stores the complete immutable commands in device-local IndexedDB before dispatch, without a server-side plugin journal. Local desktop integration keeps a private request journal under the T3 data directory (`send-to-t3-code/desktop`). Journals retain prompt/image bytes to retry exactly; they contain no session credentials. In local mode, T3 credentials are issued through its official CLI and revoked after use. Direct pairing sessions stay in device-local app storage. Official CLI output is bounded and each CLI operation times out after 45 seconds. Note contents and image payloads travel in authenticated HTTP request bodies, never shell commands or CLI arguments.

## Development and release pipeline

The canonical source checkout is `/home/ubuntu/projects/send-to-t3-code`. It is deliberately separate from both installed copies:

- `/home/ubuntu/Obsidian Vault/.obsidian/plugins/send-to-t3-code` is the development-vault installation and contains only runtime artifacts plus its local `data.json`.
- `/home/ubuntu/vaults/QLO2/.obsidian/plugins/send-to-t3-code` is the QLO2 installation published by Obsidian Sync.

Requires Node.js, npm, and Python 3. Run `npm ci`, `npm run build`, and `npm test`. Build output is `dist/main.js`; a build never writes into a vault. The plugin registers Obsidian's vault/metadata events and editor/file menus. See [Obsidian plugin setup](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin).

For a release, run `npm run release:qlo2 -- --bump patch` (or `minor`/`major`) on the VPS. This single entry point aligns all version files, builds, runs the complete test suite, creates a new immutable archive, installs only runtime artifacts in the development vault, backs up QLO2, preserves `data.json`, installs atomically, pauses continuous Sync, forces a fresh one-shot scan, requires `Fully synced`, and restarts continuous Sync. It refuses a dirty worktree unless the user explicitly authorized `--allow-dirty`, refuses an existing archive/receipt, and refuses a version that is not newer than QLO2.

If an immutable archive was created but installation or Sync failed, resume those exact bytes with `npm run release:qlo2 -- --resume VERSION`. Never delete and recreate a versioned archive with different contents.

The deployment receipt is intentionally marked `awaiting-live-smoke`. After a real QLO2 client receives Sync, reload the plugin and exercise the changed behavior. Capture durable evidence and complete the release with:

```sh
npm run release:qlo2 -- --complete-smoke VERSION \
  --device DEVICE \
  --evidence /absolute/path/to/evidence.png \
  --notes "Exact behavior verified"
```

A change is not live or complete until that immutable smoke receipt exists. Backups and receipts live outside the synced vault under `/home/ubuntu/backups/send-to-t3-code`. Direct `scripts/deploy-qlo2.py` use is retired so old instructions cannot bypass versioning, tests, packaging, or smoke evidence. Do not route QLO2 installation through the Windows laptop.

Git tracks the TypeScript source, tests, release tooling, and dependency lockfile. Generated `dist/`, packaged releases, local validation artifacts, and Python caches are ignored.

This is a local community-plugin-format build; it has not been submitted to or approved for the public community directory.

The browser-targeted bundle includes portable hashing and binary utilities. Desktop Node imports live in `desktop.ts`, loaded only after a platform guard. Tests evaluate the built bundle without `process`, global `Buffer`, or access to Node modules, then send an image note through mocked Obsidian APIs. This is a compatibility test, not a substitute for testing on an actual iPhone/Android device.

Release 2.3 passes 32 automated tests covering native email verification, wrong-code/expiry errors, credential rotation, device-bound proof verification, automatic multi-machine connection, partial offline recovery, renewal coalescing, sign-out and cancelled verification. The built mobile bundle is tested without Node APIs. Live desktop validation records are kept locally in the ignored `evidence/` directory; actual iPhone/Android verification remains separate.

Live 2.3 validation in QLO2: one email verification connected both laptop and VPS, plugin reload preserved sign-in, and Files-pane right-click sends to both hosts completed with two correctly recognized images. Original user settings were restored and test notes removed.

Live 2.7 desktop validation: the real command-palette row submitted the exact typed prompt and received a completed T3 response. A linked folder sent nothing with its trigger disabled, sent one tagged note after enabling, and created no duplicates after repeated edits and a rename. Build and all 66 automated tests passed, including mobile-compatible bundle delivery, palette lifecycle, event parsing, folder renames and retry durability. Test notes were removed and original development-vault settings restored.

Version 2.7.1 restores the folder-link dialog with an optional tag switch. Live desktop testing verified Files-menu selection, the inactive default, enabling a tag and explicit persistence. All 69 automated tests pass, including cancel, reopen, ownership preservation and storage-error recovery.

Version 2.8.1 adds the new/existing-thread choice to command-palette chat and labels existing-thread choices **Active** or **Idle**. Active threads remain selectable and use T3's steering behavior. All 87 automated tests pass.

Version 2.8.2 separates the destination filesystem path from the vault-relative path. A same-connection vault-root link maps synced mobile notes to their destination path; without a safe mapping, chat sends the vault name and relative path once rather than duplicating it.

Version 2.8.3 adds live **T3** badges to explicitly linked folders in Obsidian’s Files explorer and clarifies that command-palette chat never triggers archive or delete completion actions.

Version 2.9.0 adds machine selection and remote vault-project setup through existing T3 connections. Synced identity verification supports different vault names and paths across computers. Mobile can browse the selected computer, reuse or register its vault project, and continue the original chat. File access uses T3's authenticated WebSocket API; project creation uses its existing orchestration API. No server-specific hostnames or filesystem paths are embedded in the feature.

Version 2.9.1 replaces the colored folder badges with the T3 logo and linked project name. The label follows the Obsidian theme and truncates long names to fit narrow sidebars.

Version 2.9.2 fixes new threads inheriting a recent conversation's model and reasoning effort. Desktop and mobile now read the selected machine's current T3 settings through its authenticated connection, respecting project overrides and automatic model selection. This applies to command-palette chat, note-menu sends, and tag sends. Existing threads and saved retries retain their original selections.

Version 2.12.0 adds the durable event/coordinator/runtime foundation and the explicit Workflows v1/v2 selector. Only the selected version runs or exposes controls. Switching versions disables and remembers the outgoing version's enabled definitions and restores the selected version's saved set. Both engines now receive events exclusively through the common durable observation pipeline.

Version 2.12.1 makes workflow settings safe across devices. Established vaults no longer rewrite synced settings on startup, device-only state never touches `data.json`, every shared write merges the latest workflow records first, and workflow revisions plus deletion tombstones prevent a stale device from restoring a deleted workflow.

Assistant response HTML outside code is displayed literally so tag-like placeholders cannot disrupt Obsidian Live Preview. Markdown paragraph quotes, inline and fenced code, and URL/email autolinks retain their formatting. This is renderer-side processing; agent prompts are unchanged.
