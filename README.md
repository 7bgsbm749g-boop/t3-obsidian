# T3 Code

Connect Obsidian notes to [T3 Code](https://github.com/pingdotgg/t3code). Send notes and selected text to an agent, stream replies into the editor, and link folders to T3 projects. The repository is **t3-obsidian**; the plugin appears as **T3 Code** in Obsidian.

This is an independent community integration, maintained by the contributors to this repository. It is not an official T3 Code or Obsidian product.

## Install

The plugin is being prepared for submission to the Obsidian Community directory. Until it is listed, download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub release](https://github.com/7bgsbm749g-boop/t3-obsidian/releases/latest), place them in `<vault>/.obsidian/plugins/send-to-t3-code/`, then enable **T3 Code** in Obsidian's Community plugins settings. Reload the plugin after an update. The folder and internal plugin ID remain `send-to-t3-code` so existing installations keep their settings, hotkeys, and local storage.

Obsidian 1.8.7 or later and a running T3 Code installation with Orchestrator v2 are required. Desktop and mobile use T3 Connect; the local CLI option is desktop only. See [Setup: desktop and mobile](#setup-desktop-and-mobile) for sign-in and pairing.

## Privacy, network access, and cost

The plugin is free and open source under the [MIT license](LICENSE). T3 Code and the selected model provider are separate services; provider accounts or paid usage may be required. The recommended connection requires a T3 account. Manual pairing and the desktop local CLI are alternatives described below.

The plugin sends the note text, selected text, images, and file context that you choose to the selected T3 environment. T3 then uses the model provider configured for that conversation. Account sign-in connects to T3's Clerk authentication service and T3 Connect relay. Remote file access, conversation updates, and response delivery use the connected T3 environment's authenticated HTTP and WebSocket APIs. The destination machine must be online. Review your T3 and model provider settings before sending private content.

On desktop, the plugin can access files outside the vault to find the official T3 CLI, read and write files in connected project folders, stage agent note edits, and keep private response and command records under the user's T3 data directory. These records can contain note text and model replies. Device credentials stay in local Obsidian storage and IndexedDB; they are not saved in synced plugin settings. This plugin includes no client-side telemetry or advertising.

Report problems through [GitHub Issues](https://github.com/7bgsbm749g-boop/t3-obsidian/issues). Include the plugin version, Obsidian version, device, and steps to reproduce; remove private notes and credentials from reports. Bundled dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Features and usage

One Obsidian plugin for desktop and mobile. Chat from the command palette, send a Markdown note to a T3 project, or ask a thread to watch a note or folder. Linked folders choose the destination for notes below them. Manual sends preserve Markdown and embedded images.

Completed-reply highlights use T3's shared read state. Reading the result in T3 clears its note highlight; viewing it in Obsidian marks only that displayed result read in T3. See [unread completion glow](docs/completion-glow.md).

The plugin requires T3 Orchestrator v2 on each destination computer. Update T3 before connecting. Existing project, thread, and message IDs remain valid after T3's migration. T3 does not migrate old provider runs or pending approvals; those old controls cannot resume. New messages use the v2 delivery policy and keep the existing thread's permissions and model. See [Orchestrator v2 compatibility](docs/orchestrator-v2.md) for recovery and validation details.

## Import and command performance

Run imports read T3's canonical run/prompt records. They do not enumerate legacy response leases or send import requests through a host mailbox. The installed T3 API exposes its complete run list through the full thread projection; this metadata read does not hydrate tool details. A separate run-only endpoint would also reduce the initial network payload. The selected response uses the same local reply path as new sends. A small note-local import receipt prevents duplicate imports after completion, reload, rename, and Sync. Old lease records are not consulted.

Importing a run makes its source thread the note's previous thread. Later **Send to agent** actions continue there automatically with Smart Send: imported output and input echoes are excluded, and text already sent to that thread is not sent again. Unsent user text remains eligible. Importing does not send a message or reset the thread's sent-text record.

Desktop agent commands use an authenticated loopback HTTP endpoint. Its private endpoint descriptor and exact request/result receipts stay outside the vault. The plugin does not scan request history or execute old requests after startup. Retry the same UUID and input after a lost acknowledgement. `--retry` can retry a saved failure; successful receipts are replayed without executing again. A closed plugin does not accept or queue new commands. Retired lease maintenance commands fail explicitly. Updated laptop helpers use the same direct endpoint over private SSH.

Project media discovery and resource renewal run when media is rendered. Ordinary `Vault.read` and `cachedRead` calls do not parse Markdown or search project files. The old full-note image parse cache is removed.

## Incoming messages and senders

Connection retries keep the normal live response display and the latest received text. Restored replies do not show a reconnect banner. Automatic recovery continues in the background.

Large tool groups use small summaries in Live Preview. Open a group to load its complete output. The saved note and recovery records keep the full output. Smart Send excludes generated output from automatic note context. Source mode shows the full saved Markdown. The editor rejects changes that would save a summary without its original output.

Questions and destination choices open in a panel at the bottom of the current note tab. Ask agent opens a separate rounded composer there. The panel covers the note content, uses Obsidian's theme and controls, scrolls within the tab, and closes on Escape or when you switch notes or tabs. Workspaces without an open note use the standard Obsidian modal.

Thread selection reads current control state without downloading tool output. The selected-thread check has a five-second limit, supports Retry, and stops when the panel closes. You can click the previous-thread action immediately; the send waits for that exact check. New thread and Existing thread remain available during the check. Sending still checks the current project, turn, approval, and input state.

An open send window follows the current send state. While another send is in progress, its controls are disabled and it explains the wait. When that send finishes, the controls become available without reopening the window. The selected project, message, overrides, and conversation check are preserved.

New replies stream directly from T3 into the plugin on each active device. The note saves only the existing hidden response container and ID. Its connection record is in the plugin data.json responseBindings map; intermediate text stays in the local view. A second device reconnects when both the note and plugin data arrive. Enable community-plugin data sync on every participating device and sync the same configuration profile. Other sync services must include that plugin data file. After T3 confirms the exact final response, a loaded device replaces the container with ordinary Markdown. Existing response-binding comments move into settings before they are removed; ordinary note text is retained. Automatic final saves check the destination note's Sync state. A verified current note can finish while unrelated files or plugins transfer; pending note changes still wait. Unsupported Sync internals retain the whole-vault synced check. See [per-note Sync readiness](docs/per-note-sync-final-saves.md). The write checks the latest local note and preserves ordinary edits. Matching final notes are accepted by Obsidian Sync without a text merge.

The lease reply system is retired. Its unfinished replies are canceled rather than migrated. New sends, imports, and thread-stream subscriptions all create local reply bindings. Old queued jobs and saved lease attachment plans cannot resume. The release disables the standalone reply service and cannot package or install it. Agent staging stays private and uses the existing checked file transport.

Other Sync services do not share a status API. They use the same local checked save and normal file propagation. This does not promise a single global save attempt or prevent all conflicts between different note contents. Native iPhone and Android verification remains separate from the desktop and Headless Sync evidence.

Question status follows the live response feed and has a small control-read fallback. Visible questions and open forms stay monitored even when the saved note has only a response anchor. Concurrent refreshes share a read. Submit shows feedback immediately, performs one fresh control check, saves the exact answer command, and dispatches once. “Answer sent” means T3 accepted the command; the panel closes only after resolution. Lost acknowledgements retain the same command for a safe explicit retry. Draft writes are grouped while typing and flushed on close, submission, app backgrounding, or plugin unload. See [question performance and recovery](docs/question-performance.md).

Submitted question answers use a closed **User input submitted** row in the editor stream, with a short answer preview. Open the row to see the original questions and full answers. Each row keeps its place in the conversation and its open or closed state while the stream updates. Saved question records retain the display after recovery; older records without a question show the saved answer alone. Ordinary prompts and steering keep their existing quotes. See [submitted answer display](docs/submitted-answer-display.md).

An answer submitted after its source run finishes starts a new editor stream in the note that opened the question form. The saved reply remains in place. The new stream follows only T3's exact answer message. Accepted answers retain a local recovery intent until the stream is attached; reloads and retries do not send the answer again or recreate a completed stream. Answers within the source run keep their current stream. See [late question answer streams](docs/late-question-answer-streams.md).

When T3 has accepted a message, a later local display or save failure retains its response and note/thread link. The notice identifies the accepted thread, and the failure log records accepted delivery. Local recovery never sends another prompt or interrupts that accepted work. Sends without acceptance evidence retain their terminal failure handling.

Stop seals the local response, then interrupts only its exact T3 run. Completed turns do not stay active while a final note save is pending. A Stop for an old run cannot interrupt a newer run.

Final saves retain their writer grant and exact output through a reload. Automatic recovery can replace an old save attempt only when the journal proves that it made no write. An uncertain old attempt needs review of the current saved note hash. Saves keep the native editor, multi-pane, rename, and Sync checks. Native autosaves advance the editor's comparison copy only after the captured save completes and its exact bytes are read from disk. A blocked final save can read fresh disk state and retry; later typing stays in the editor, while genuine competing edits still prevent an unsafe write. Automated reload waits for ordinary edits, response recovery records, and final save operations.

Live thread snapshots request T3's compact format. This removes duplicate timeline objects from the download; messages, reasoning, tool output and questions remain available. The plugin restores local timeline entries before it reads or displays them. The desktop host shares a live transcript for each thread instead of repeatedly downloading it while a reply runs. A cold connection and recovery can still read a compact snapshot.

For T3 protocol 2, the exact run's completion event starts final delivery. The plugin reads its authoritative final item once and checks the thread/run/message IDs. Canonical text replaces the preview directly, with the intermediate history and final-answer layout retained. Healthy v2 streams do not repeatedly poll thread snapshots. Reconnect still recovers canonical state. A ready connection or replay-end marker does not prove completion.

Final save verification protects the generated response and staged edits. Ordinary typing outside those ranges can continue after the write without making a saved reply fail verification. Old false readback conflicts recover from the saved file without another note write. Native file updates merge current typing rather than automatically discarding the editor buffer. Genuine overlapping edits retain the current buffer and the incoming version, and do not produce repeated popup warnings. Conflict histories retain only their first and latest snapshots; identical originals and proposed notes are stored once. Completed journals retire after their matching host acknowledgement.

HTTP, CLI and unary RPC responses have an 8 MB byte limit. If a read exceeds it, that response block shows **Reply not saved: T3 data exceeds the 8 MB limit.** It retains received text and stops repeating the oversized download. A blocked snapshot does not stop the live feed or a separate small final-item check. A blocked final item remains unsaved. The plugin does not resend the prompt. Other response blocks continue independently.

For a legacy save conflict, inspect the candidate on the device that owns the writer grant, then retry with the returned `currentHash`:

```sh
python3 scripts/obsidian-command.py --vault /path/to/vault \
  response-recovery-info --binding-id RESPONSE_BINDING_UUID
python3 scripts/obsidian-command.py --vault /path/to/vault \
  retry-response-save --binding-id RESPONSE_BINDING_UUID --hash REVIEWED_CURRENT_HASH
```

These commands return IDs, paths, hashes, and save status. They do not return response bodies or writer credentials. A missing or changed response anchor prevents automatic insertion. Keep the request UUID and exact arguments when retrying a command after a timeout.

Steer callouts come from T3-confirmed incoming messages, including messages sent through fleet or T3's own composer. Local Obsidian sends retain their **You** label. Once that exact message is confirmed and displayed in the stream box, its unchanged source text is removed from the editor and saved, while the response is still running. Selections and whole-note additions use exact source ranges; previously sent context, later edits, failed sends, and other mirrored destinations keep their text. External inputs never remove editor text. Canonical display records and local selection receipts are separate, and message IDs deduplicate snapshots, live events, reloads and recovery.

The VPS fleet adapter attaches a `fleet-sender` context record after verifying the caller's local Codex session against its T3 thread. Valid records display **Agent · source title**; unattributed messages display **User**, including question answers without author evidence. T3's user role and message prose do not identify an author. This metadata is a trusted-client display convention, not a signed identity. Native T3 author headings remain a platform limitation. The laptop adapter has not been updated or verified for this change.

Live events retain the existing complete-paragraph boundary, including code-fence protection. The installed T3 detail feed omits start-request events, so incoming-message display uses the observed active response or its canonical lifecycle; it never treats that display association as an execution binding or a reason to adopt another turn. A recovered input without an observed boundary is marked **Recovered (paragraph position approximate)** because snapshots cannot reconstruct historical growth within one assistant message. Completed reply blocks retain their exact response binding. The existing opt-in `stream-thread` registration displays future turns in its chosen destinations; it now includes each turn's canonical initial input and sender label.

## HTML results

T3 `html_render` results appear as live pages in Live Preview and Reading mode. Pages keep their scripts, charts and controls. They remain visible outside folded tool history and above the final answer. Hover, focus, or tap to use **Expand HTML**; the expanded view has zoom controls. Escape returns from the page. Source mode shows a small `t3-html` reference instead of page bytes.

The plugin verifies the exact completed T3 tool item, then downloads its attachment through the existing authenticated connection and signed asset API. HTML runs in an opaque-origin sandbox, with no Obsidian or Node API. T3's theme and size messages adapt the page to the note's colors, fonts and width. Other response HTML stays escaped.

Verified page bytes are cached in device-local IndexedDB, outside the synced vault and plugin settings. A downloaded, self-contained page can reopen offline, including after a plugin reload. The cache retains at most 64 pages and 100 MiB; each page can use up to 25 MiB. A new device must download a page while connected. Remote scripts, fonts, images and live data still require their network sources; caching the HTML does not package those dependencies. Cache failures show a small Retry control and do not block the reply's final save. No attachment folder is created in the vault.

See [HTML result integration and validation](docs/html-results.md).

## Thread event subscriptions

The plugin notices changes; the subscribing T3 thread decides what to do. There is no workflow builder, stored task definition, setup thread, or new thread for each change. An agent registers a subscription through the same private command mailbox used for note sends. A subscription contains only a note/folder scope, selected change types, and the originating thread, project, and machine IDs.

With no enabled subscriptions, note monitoring and automatic activity logging are off. The command listener stays available so the next agent can register a subscription. Pausing or cancelling the last subscription stops recording; subscription records remain untouched; the activity log still resets daily. Old folder-workflow definitions are ignored and do not migrate or run. The retired menus, badges, settings, setup compiler, event journals, coordinator, and execution engine have been removed.

A subscription watches future saved Markdown changes from its registration. It supports creation, text modification, rename, deletion, or a named frontmatter property changing (optionally to an exact JSON value). Property values are compared by type, so `true` differs from `"true"`. Invalid YAML does not count as a property transition. Folder scopes may include subfolders; `/` watches the vault. Hidden paths and plugin log notes cannot be watched. Explicit note/folder scopes follow renames; a folder subscription continues watching its path after deletion, so a later recreated folder is covered.

Rapid changes to the same note are grouped after 1.5 seconds of quiet, with a maximum 30-second wait and the last 32 transitions retained. Notifications contain paths, change types, timestamps, text hashes, and bounded property before/after values. They do not archive full note bodies. The thread can read the current note itself. A busy thread's notification waits in the saved queue. The exact T3 message and command IDs and bytes are saved before dispatch and reused after interrupted delivery. Delivery never creates a new thread or changes the existing thread's model or permissions. `subscriptions` reports active scopes and pending deliveries, including retry errors.

Active response containers are excluded from note-change events. Completed replies become ordinary Markdown. During a notification turn, changes in that thread's subscribed scopes are suppressed until the thread becomes idle and the plugin refreshes its baseline. This also includes user edits during that turn. Avoid subscribing threads to each other's output in a cycle.

Subscriptions and the delivery queue live in the vault connection machine's private `.obsidian/t3-code/events/v1` store, outside Obsidian Sync. Every desktop's local agent mailbox forwards commands to that host through authenticated T3 file access. A separate host lock gives one Obsidian client capture and delivery authority; loss of the lock stops both. Keep Obsidian on the designated machine open and connected to the receiving thread's computer. Results identify the responsible host. An unavailable host never starts a local fallback watcher: retry the same request UUID. Changes from mobile or another computer are observed when Sync delivers them. No intermediate changes are reconstructed while the host is closed. On reopening or resuming, existing notes become a silent baseline; saved pending notifications resume. Updating, pausing, or cancelling cancels unsent notifications; an already accepted message cannot be recalled.

Changing the vault connection machine stops the old watcher without automatically transferring its state. The designated host imports its own pre-2.28.1 local subscriptions once; legacy subscriptions registered on other desktops require explicit recreation after updating those clients.

Subscriptions retain compact lifecycle observations for active source threads. Disabled and completed watches release their cached histories; explicit resume reads canonical history again. Observations include user prompts, run bindings, status, and approval/input transitions. Tool output, reasoning, and assistant bodies are discarded. One live monitor serves each source thread; a canonical read refreshes it at most every 30 seconds, immediately after reconnect or for an explicit registration/resume boundary. Irrelevant events advance an in-memory cursor without rewriting the store. Restart conservatively replays from the last durable cursor. Notification and attachment intents are still saved before external effects.

Thread-stream attachment lookup uses the synced local binding map. It does not list leases or read historical reply bodies. A stable binding ID prevents duplicate attachments after a retry.

An attachment retry checks whether its destination exists before reading historical bindings. Missing notes keep their saved attachment plans and resume when available. Repeated identical attachment errors do not rewrite the subscription store. Other destinations continue through the same pass.

Bounded HTTP bodies use the platform UTF-8 decoder. Private journal validation reuses verified paths and file identity records while freshly checking every revision's identity, including nanosecond change times; it still rejects tampering, missing revisions and symlink replacement.

### Register and manage subscriptions

Use the real originating T3 thread, project, and environment IDs; the plugin validates that the thread exists on that machine in that project. Do not substitute another thread or create a new one to receive each event.

```sh
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  --request-id REQUEST_UUID subscribe \
  --scope Gym --scope-kind folder \
  --event property --property completed --equals true \
  --thread-id THREAD_ID --project-id PROJECT_ID --environment-id ENVIRONMENT_ID
```

The returned `subscriptionId` is the registration UUID. Omit the property options and use `--event modify` for any saved text change. Repeat `--event` to watch several of `create`, `modify`, `rename`, and `delete`; property filters are separate subscriptions. Use `--scope-kind note --scope 'Gym/Session.md'` for one note, or `--no-subfolders` for direct children only.

```sh
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 subscriptions
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  update-subscription --subscription-id SUBSCRIPTION_UUID --event modify
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  pause-subscription --subscription-id SUBSCRIPTION_UUID
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  resume-subscription --subscription-id SUBSCRIPTION_UUID
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  cancel-subscription --subscription-id SUBSCRIPTION_UUID
```

Updates may replace a scope or filter, but cannot change the receiving thread. After a timeout, reuse the exact request UUID and arguments. After a failed command, fix the cause and use `--retry` with the same UUID and input. A fresh `subscriptions` command uses a fresh request UUID to get the current state. The agent instructions are maintained in [the Obsidian T3 skill](docs/obsidian-t3-SKILL.md).

## Setup: desktop and mobile

1. Install and run T3 Code on your computers. Sign in to the same T3 account and enable **T3 Connect** on each destination. T3 supplies the public HTTPS connection; no Tailscale or plugin companion is required. See [T3 remote access](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md).
2. Install `main.js` and `manifest.json` in `<vault>/.obsidian/plugins/send-to-t3-code/` and enable the plugin.
3. In **Settings → T3 Code**, keep **T3 Connect (recommended)** selected. Enter your T3 account email and click **Send sign-in code**.
4. Enter the six-digit code from T3’s email and click **Verify and connect**. The plugin discovers your account’s computers, authorizes each online connection and scans its projects automatically. No terminal commands, machine URLs, pairing links or per-machine codes are needed.
5. Every discovered project appears automatically in the folder and send project menus. Their names include the destination computer. On mobile, use the note menu → **Open in T3 Code**, or the command palette’s **T3 Code** row.

Sign in once on each device. Connection names and folder links sync; credentials and derived project snapshots stay on that device. Cached projects appear immediately, including offline machines, and are labelled when their availability is unverified or offline. Sending still requires an authenticated, reachable destination. Projects refresh automatically on startup, sign-in/pairing, changed synced connections, resume/network reconnection and while Obsidian is active. All registered account machines and saved connections are refreshed with up to three concurrent machine reads. One offline machine cannot remove another machine’s projects. Failed reads preserve that machine’s last snapshot; a successful empty read clears it. Retries back off from 15 seconds to five minutes. Healthy catalogs refresh about every five minutes. **Refresh connections** can also retry immediately. Discovery never sends or replays a note.

Project snapshots use vault/device/account-scoped IndexedDB storage, seeded from legacy project arrays when no local cache exists. Fingerprints suppress unchanged local writes and project-list notifications; they do not avoid network requests because T3 provides no conditional project-read endpoint. Project selection toggles and the manual project scanning menu have been removed. Folder routing, remembered threads and saved retries keep their exact machine/project identities.

This is an independent integration with T3’s existing native authentication and relay APIs. Email verification uses T3’s Clerk native frontend API, enabled by T3, and its `t3-relay` token template. The relay accepts that credential and issues device-bound connection grants. The plugin requests only environment thread read/operate scopes. It does not read installed T3 credentials or browser cookies, impersonate an existing device session, register a replacement `t3code://` handler, or need access to your email inbox. It does not collect your T3 password or create a new T3 account.

Account/session tokens stay in device-local, vault-specific Obsidian storage and are not OS-keychain encrypted. The device’s non-extractable DPoP signing key stays in local IndexedDB. Neither is written to the synced vault. Email verification codes are not retained. **Sign out** removes account credentials and account-managed environment sessions on this device, and asks T3 to revoke this sign-in session. Independently paired manual connections are retained. If revocation cannot reach T3, the plugin reports that local sign-out succeeded and directs you to T3’s account controls for remote revocation. A cancelled or expired sign-in does not restore account access later.

Sources: [T3 relay authorization](https://github.com/pingdotgg/t3code/blob/main/infra/relay/src/http/Api.ts), [T3 managed account authentication](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/cloud/managedAuth.tsx), [Clerk email-code sign-in](https://clerk.com/docs/guides/development/custom-flows/authentication/email-sms-otp), and [Clerk native API behavior](https://clerk.com/docs/guides/development/errors/frontend-api).

### Advanced: manual pairing

After account connection finishes, existing manual pairings still work. Expand **Advanced: manual pairing** to use a known HTTPS environment address and a fresh T3 pairing code or link. A hosted `https://app.t3.codes/pair?host=…#token=…` link is accepted. Manual pairing is available without account sign-in. Each device pairs separately; manual sessions require pairing again after their displayed expiry. Re-pairing preserves folder routing and pending requests.

T3’s Connections page currently hides its pairing controls when Network access and Tailscale HTTPS are both off, even when T3 Connect is enabled. In that case the official `t3 auth pairing create --ttl 10m --label Obsidian --json` command on the destination can issue a code without changing its network settings. This command is **not needed for the recommended account setup**.

Manual pairing exchanges a one-time code for a scoped bearer session. The code is discarded, and the session remains only on this device. **Forget pairing** removes the local credential; revoke its client session in T3 Settings → Connections to revoke server access. Remote connections require HTTPS and refuse redirects; HTTP is allowed only for loopback testing.

### Advanced: this computer only

Desktop users can choose **This computer only (advanced)** to use local T3 without account sign-in. Install T3 and its matching official CLI. The plugin discovers the CLI in standard locations or PATH; executable and data-directory overrides are available if needed. Registered local projects appear automatically and refresh in the background. The CLI issues five-minute sessions for T3’s authenticated loopback API, which the plugin revokes after each operation. No shell interpolation, Python or Fleet adapter is used. This option is unavailable on mobile.

File connections send a health check after five seconds without a valid reply. Three more seconds without a reply confirms a silent connection and closes it. A safe file read can use one fresh connection; prompt sends and uncertain writes are never repeated. A slow request on a responding connection keeps its own 15-second limit and does not cancel other requests.

On desktop, failures on two distinct connections to the same response host within one minute can trigger one automatic Obsidian reload. The native reload starts immediately, including with unsaved edits, active responses, open dialogs, or newly synced runtime files. Recovery cancels a pending reload. A device-local record prevents repeated reloads during one outage and retains a five-minute limit after recovery. See [connection recovery](docs/connection-recovery.md) for diagnosis and test coverage.

The destination must remain online. There is no offline queue or automatic resend. A failed send ends immediately: its response stream and activity indicators disappear, and the plugin does not resend it. Device-local command IDs identify the attempt and its failure; they do not create a Retry queue. Completion monitoring uses the same connection while Obsidian is active.

Desktop response discovery verifies file identities and reuses unchanged records. Historical reply bodies no longer need to be read and parsed again at each live scan.
Native preview checkpoints compare fields without serializing large reply bodies. Metadata-only updates reuse the same body's checked boundaries; new reply text and saved previews are fully validated.

New threads use the selected machine's T3 model and access defaults: an explicit project override takes precedence over the environment default. Configured model options, including reasoning effort, are preserved; previous threads do not supply model, reasoning, or access settings. If T3 is set to automatic model selection, the plugin uses an enabled provider's advertised default model. When an older T3 configuration omits the access setting, new threads use T3's Full Access default. Existing-thread sends retain that conversation's model and permissions. Each send captures its model, access mode, and commands before dispatch.

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

Old unconfirmed sends are closed on upgrade, their response displays are removed, and their failure identities are recorded locally. If an acknowledgement was lost, check the original thread in T3 before choosing to send new work. Old companion completion jobs keep their notes and stop monitoring. Direct/local completion monitoring continues. No request is automatically rerouted or sent during migration.

The obsolete companion service is no longer part of the plugin. Its operator can stop/remove it after upgrading their clients. Historical state backups may be retained privately, but neither companion nor queue files are read by this plugin.

## Command palette

Open Obsidian’s command palette (Ctrl/⌘ + P, or your configured mobile swipe-down action). Its first T3 Code row changes with the editor selection and palette input:

For a keyboard shortcut, assign **T3 Code: T3 Code** under **Settings → Hotkeys**. One command handles both modes: with no selected text it sends the full note; with selected text it asks about that selection. It sends to the current default destination without opening the project/thread selector and follows the same editor streaming switch. Hold Control while activating a palette row or menu action to open the selector. Control required by the configured Send shortcut does not count as an extra selector gesture. Assign **Send or Ask T3 Code: choose destination…** a separate shortcut for explicit destination selection; the command is also available without a keyboard. It ignores saved command-palette drafts. No default shortcut is assigned. The command is available in Markdown editors, including mobile with a keyboard, and remains available in the ordinary palette if the dynamic T3 row is unavailable.

Choose **T3 Code: Stop all T3 responses in current note** to clear every active or failed response in the open note, including responses started on another device. This works on mobile without selecting text or opening an editor context menu. It preserves the reply text, removes stopped progress and input controls, and requests interruption of each response's bound T3 turn. Remote stops retry while Obsidian is open if the host is unreachable. Completed replies and responses in other notes are preserved. If there are no active or failed responses, the command reports that there is nothing to stop.

| Selection | Typed input | First row | Sent to T3 |
| --- | --- | --- | --- |
| None | None | **T3 Code** | Full Markdown note and embedded images |
| Text | None | **Ask T3 Code** | Selected text, its embedded images, and note location |
| None | Text | **T3 Code: “…”** | Typed question and note location |
| Text | Text | **Ask T3 Code: “…”** | Selected text, its embedded images, typed question, and note location |

The palette keeps one device-local draft. A confirmed question clears it. Sending uses the same note/image packaging as **Open in T3 Code** in the Files sidebar; asking does not copy the full note. Ordinary Send and Ask actions use the current default automatically: the relevant running response for an Ask, otherwise the note’s remembered thread, or a new thread when neither exists. Thread checks retain their five-second timeout and block duplicate manual activation. Missing, unavailable, or blocked defaults report an error without starting another thread; an unsuccessful palette send retains its draft. First-time vault connection setup can still require a chooser. Hold Control when clicking a menu action or activating the palette row (including Control+Enter) to open the shared compact selector. On mobile, **Open in T3 Code: choose destination…**, **Ask T3 Code: choose destination…**, and the explicit chooser command provide touch access. The selector’s default destination is checked against T3: **Send to running thread** identifies an active conversation, **Continue thread** an idle one, and **Thread unavailable** disables a missing or unreachable target. Its title and short ID identify the conversation. Selection asks can target a specific response; whole-note sends use the note’s remembered thread. **New thread** and **Existing thread…** offer explicit alternatives. A stale Working header alone does not establish activity, and explicitly choosing another thread bypasses it. The buttons wrap to fit narrow screens. Pressing Enter chooses the purple default button. Click the project-name button to select a project for this send. Its tooltip includes the source note path. The displayed project applies to **Continue thread**, **New thread**, and **Existing thread…**. The initial selection uses the note’s remembered project, then its nearest linked folder, then No project. **New project: <containing folder name>** is an explicit option in the project selector for an unlinked folder. Opening or cancelling the dialog does not create a project or link. Choosing No project leaves the folder unlinked. Every note send or manual message ends with exactly **Sent from Obsidian.**, **Vault: <vault name>**, and **Note: <vault-relative source path>**. With no note open, the final value is **(no note open)**. Reply placement, note-edit commands, and wait instructions are supplied by the agent skill, not appended to prompts.

Click **Overrides** next to the project button to choose settings for one new job: **Stream replies into the editor** (On / Off), **Final answer format** (Current formatting / Raw Markdown). Each control starts at **Use default**, showing your current setting. **Apply** saves the dialog draft, **Cancel** discards child-dialog edits, and **Reset overrides** restores inheritance. The button counts explicit choices, including choices equal to the current default. Turning streaming Off disables the dependent controls while keeping their draft values. Global settings remain unchanged.

The draft survives project changes, returning from the existing-thread picker, and errors before a job is saved. Closing the send dialog discards it; the next send starts from defaults. Effective choices freeze when you activate an automatic send or confirm a selector destination (when selecting a thread for **Existing thread…**) and are saved before dispatch. Reload, handoff, and every mirror of an accepted response use the captured choices. **Send to running thread** keeps the running response’s established streaming and rendering policy and existing block; **New thread** uses the overrides for a fresh response.

When a note has no remembered thread, its nearest explicitly linked folder supplies the destination, including for notes in subfolders. Unlinked notes, root-level notes, and chat with no note open use **No project**. T3 supplies its own internal workspace; the plugin does not create a project at the vault root. Each connected computer can be selected under **No project · <machine>**. Existing conversations remain in their original projects and keep their note history. Only selecting **New project** and confirming a new-thread send opens the external workspace picker. Cancelling creates no thread or folder link. A confirmed send saves the external folder link; failed delivery does not save a new folder link.

Manage the vault connection under **Settings → T3 Code → Linked folders → Vault connection → Connect vault / Change machine**. Choose a machine and its existing synced vault folder. The plugin verifies the synced vault identity and saves the machine and path without registering a T3 project. This location hosts note subscriptions, followed-thread subscriptions, and staged note edits. It also selects the default machine for new No project conversations. Existing root records remain readable as vault connection locations; no history or note migration runs. Cancelling keeps the prompt ready.

Vault identity, known machine locations, and the chosen vault connection sync in plugin settings; credentials remain device-local. Enable community-plugin settings in Obsidian Sync on participating devices. A matching name alone never connects a folder: different local vault names are fine, but the synced identity must match. New replies stream and save on the current device. Subscriptions and staged note edits still require their selected desktop vault client. The connection does not provision Sync or upload a replacement vault.

Newly connected remote vaults check that the referenced note appears in the destination folder before sending, briefly waiting for Obsidian Sync if it is missing. This checks file presence, not whether every edit or attachment has finished syncing. The footer uses the same vault-relative source path on desktop and mobile. The authenticated **note-context** command resolves exact send identities, destination bindings, host locations, and the saved wait preference outside the prompt. It refuses ambiguous matches. `--vault` accepts a verified path or a unique vault name from Obsidian’s local registry.

The live row uses isolated, version-checked internal command-palette methods because Obsidian does not expose a public dynamic-result API; keep the core Command palette plugin enabled. The palette captures the source note, selection range, and cursor before it takes focus. Closing the palette or moving the cursor cannot move the response to the note end. Repeated passages retain the exact selected occurrence. Switching notes while choosing a thread does not change the captured context.

Questions retain the optional wait instruction and 120,000-character limit (including note context). They never enroll the note for archive/delete cleanup. Failed sends end without a retry request. **Settings → T3 Code → Send failure log** shows their device-local failure details.

## Inline responses

Under **Settings → T3 Code → Inline responses**, **Stream replies into the editor** is on by default for all manual Send and Ask actions. With an updated host and sending device, new replies stream locally and the sending device saves their final result without waiting for Obsidian Sync. A durable grant permits one final writer. If the sending device closes before that grant, the **Vault connection** can finish after its presence expires. Existing responses and older clients retain host completion. Older hosts retain exclusive device writer ownership, even when a folder link sends the T3 thread to a different machine. Turning streaming off keeps answers in T3 threads.

The open note receives reply text directly from T3 as soon as its response is registered. It does not wait for the new note anchor to reach the vault connection machine through Sync. Older host updates cannot replace newer local text. The sending device normally saves the final reply under its durable grant; the host supplies fallback completion before that grant. Sync carries the saved note to other devices. The visible status stays **Working** while the response runs or reconnects.

A receiving editor can get the final note before its completion receipt. It preserves the local and incoming versions and waits for verified completion instead of opening a conflict dialog for the expected marker removal. Matching verified bytes finish the response and close an obsolete recovery dialog. A changed generated range or an actual overlapping edit still requires recovery. Changes immediately outside an intact, uniquely identified response, including removal of adjacent blank lines, are merged without changing the response. A stored local conflict is reported once per distinct preserved version; a never-written result can resume when its current edits are proven separate.

After the final response is saved and its tracking markers are removed, its text is ordinary Markdown. The completed history's **Remove streaming block** button deletes only that block through the local editor, keeping the final answer and other note text. It works without the response host or T3 connection, requires no tracking update, and supports normal Undo, Redo, autosave and Obsidian Sync.

Manually sending a note with **Open in T3 Code** or palette **T3 Code** places its streamed reply at the captured editor cursor, after the enclosing paragraph or Markdown block when needed. A typed palette question without a selection uses the same cursor rule. File-menu and Reading-view sends append at the note end. Selection questions appear below the selected line; selections used as response references place a new reply after the selected block. The plugin opens the note in a Markdown tab if needed. A full-note send captures its content before inserting the response and sends that content and its images to T3. A streamed note stays in place even if archive or delete is selected under **When task completes**. Changing the switch affects new sends; an already active response continues to completion or until stopped.

## Ask T3 inline

While a response is running, place the cursor inside its block and use **Ask T3 Code** or type a question in the command palette and activate its T3 row. The Ask uses that running response automatically. For a selection elsewhere in the note, use **Ask T3 in this response** to explicitly choose the destination block. The plugin sends it to that response’s existing T3 thread and keeps writing in the same response block. Your input appears as a neutral indented **You** quote between the agent’s paragraphs. Selected text outside tracked responses moves from its original location only after T3 confirms the message; typed palette input is inserted directly. If the selection changed in the meantime, its edited source text is preserved. Selections inside a tracked response, or spanning its boundary, are sent as captured context and stay in their original response. Streaming can continue while the destination is checked or the selector is open; the message uses the text you selected.

Steered responses retain the assistant paragraphs around your messages in the progress box. Input positions, exact message IDs, and the transcript survive reconnects, plugin reloads, and writer handoffs. Any authenticated device can send without taking ownership of the writer. Active response contents are replaced by authoritative T3 output, including after Sync changes. Failed steering sends are logged and are not resent; an already running response keeps its accepted output. If the original turn finishes after steering is reserved, a resulting new turn is explicitly attached to the same response. If the response has already finalized or is paused before reservation, the send is refused. Pending approvals and structured questions must be answered before ordinary steering.

Select text in a Markdown editor and choose **Ask T3 Code** from the editor menu, or use the palette’s **Ask T3 Code** row. Choose **New thread** or **Existing thread…**. The plugin sends the selection, its embedded images, and destination note path to T3, then inserts a tracked response below the selected line. Add text in the palette to send a specific question about the selection. Typed Ask questions are sent under the bold **USER ASKS:** label. Typed palette questions appear immediately at the top of the response block in the same neutral **You** quote as steering messages. Only the typed question is displayed; selected context stays in its original location. The quote remains with the final answer, outside the progress box, and survives retries, reloads, and writer handoffs. The response shows **Thread name · Working** from initial submission through streaming, without a separate sending label. The working header shines from the initial response insertion while the reply streams. A matching animated row at the bottom shows the exact response turn’s current activity, such as **Reading file**, **Running npm test**, or **Thinking**. **Working** is the fallback when T3 has no specific live activity or the connection is recovering. Tool output stays in T3; approval and question prompts still appear in the note and through an Obsidian notice. Progress uses one collapsible box, open by default during work. When the final answer is complete, the box closes and the final answer stays visible below it. Each response retains this behavior through reloads and device handoffs; routine tool activity is still omitted. The completed header and elapsed duration remain. The plugin owns the note insertion. Confirmed steering moves the unchanged selected text into its **You** quote atomically with the response update; interrupted writes retry removal, and delayed synced saves cannot leave that same anchored text duplicated outside the response.

When T3 asks for input, the question text and option descriptions appear beneath the streamed progress in the same purple quote. **Answer** opens an Obsidian dialog in Live Preview or Reading view; **Answer T3 question…** also appears in the editor menu and command palette. The dialog supports single choice, multiple choice, free text, and several questions in one request. Incoming questions never open it automatically. Streaming refreshes preserve the draft, focus, and text selection. Closing the dialog saves the draft without answering or dismissing. Only **Submit answer** sends a response; a preselected choice alone never sends.

Custom answers in **Answer T3 question** retain their text when you select a preset option. The inactive draft dims and the selected option is submitted. Click back into the custom answer to reactivate it, with an accent-colour glowing border; drafts survive refreshes and reopening the dialog.

Active T3 responses animate the existing file name, ancestor folder names and open tab titles with T3 Code's text shine. Mobile Tab Bar's current title, swipe neighbours and tab overview also show the effect when that optional plugin is enabled. Response headers, current activity, live tool summaries and context compaction use the same effect. A small SVG circle with eight rounded segments accompanies only file, folder and tab titles and the top response header. The circle is capped at 10 px. Each step switches one whole segment off and the previous segment back on. Labels retain their original font family, size, weight, spacing and colour. The shine keeps most of the normal glyph rendering, with a lighter highlight on unselected titles and a stronger highlight on the selected title. The circle uses the label’s colour with lower opacity and a soft shine. No extra Working badge is added to file, folder or tab titles. Unread completions highlight the note title. Pending input adds no coloured dot beside note or folder names; questions remain available inside their responses, including async questions after a turn has finished. Response counts remain available to assistive technology. Active work and pending input can coexist when several threads or mirrored replies share a note. Failed, paused, interrupted and unresolved replies never count as completed. Indicators recover from the coordinator’s existing response records after reload and follow note/folder renames and deletion. Linked folders use a compact link icon with the full project name in its tooltip and accessible label. When **Folder notes** is enabled, folders marked by that plugin also receive their folder note’s completion highlight and accessible response counts, using its naming, storage-location and file-type settings. This optional integration does not change Folder notes or note contents. Animation pauses outside the visible area and in hidden windows; reduced-motion and forced-colour preferences retain ordinary text.

Blocking questions wait for an answer. Async questions appear as compact rows inside the response and remain answerable after the turn finishes. A completed turn shows **Waiting for answer** without a loading indicator while its final text stays visible. The original response remains attached, with a device-local recovery copy, until all questions are answered or dismissed and their follow-up turns finish. Once T3 confirms an answer, the whole pending question row disappears. A compact **User input submitted** entry retains the question and answer in the response history. A late answer continues in that same note response, including after reload; T3 can create a new turn internally. The reader follows the exact question-answer message, so unrelated turns cannot enter the response. An older saved response can reopen only when its stored text still matches one exact region; edited, copied or missing output is preserved and a notice explains why it could not resume. Only async questions offer **Dismiss**. Dismiss immediately hides the question, saves the intent before contacting T3, and safely retries after a connection failure. Closing the answer form leaves the question pending. Answer submission closes the form and hides the question only after T3 confirms resolution; a dispatch acknowledgement alone does not close it. The final checked save removes response tracking after every question and related turn has finished.

Continuing a failed response keeps its earlier progress visible alongside the explicitly attached new turn. That transcript remains in the progress box after completion. Steering uses the same transcript, so adding a steering message or answering a question does not swap the visible history. Existing checkpoints from older versions recover their adopted continuation turn when the writer resumes.

Any device viewing the synced question can answer using its own authenticated connection to the original T3 machine, regardless of which device owns streaming. The plugin refreshes authoritative request state before dispatch, preserves native question IDs and option values, and waits for T3’s resolution before clearing answer controls. Explicit dismissal hides the prompt locally at once while remote resolution finishes. An answer in T3 or another Obsidian client clears them here too. Drafts and exact pending commands remain device-local. If the connection drops during submission, reopen **Answer** and use **Retry saved answer** to retry the original command safely. Provider failures retain the draft. Existing local and hosted responses use the same question model.

With editor streaming off, the same question and note path are sent, and T3 answers in its thread without the plugin adding a response to the note. Send instructions ask T3 to answer in its thread and, when streaming, explain that the plugin inserts the reply. They do not prohibit note edits requested by the user.

On mobile, selecting text in the Markdown editor shows a small **Ask T3 Code** button above the selection. Tap it to open the same thread chooser; no mobile toolbar setup is needed. The button disappears when the selection is cleared or another note becomes active. The iOS Cut/Copy/Paste menu itself cannot host plugin actions.

Active native replies retain their last validated display in this installation’s existing private database. After an app reload, an exact matching vault, note and empty response anchor can show that preview with its normal live display before the host reconnects. Fresh direct events cannot replace it with an earlier sequence. Stop, saved completion, deletion and changed prompt identity clear that preview. This is display evidence only: it does not save generated text into Markdown, send a prompt or grant a writer lease. The cache is limited to 32 replies and eight million text characters per vault/device.

Returning to the app, regaining focus, or restoring network access restarts active native reply feeds immediately, retaining their applied event cursors and bypassing an old connection retry wait. A pause in the mobile timer loop also triggers recovery on its first returning tick. Current text is requested as soon as connection access is ready, without a browser timer or waiting for a WebSocket ticket or socket opening. On the vault desktop, reading existing response records does not wait for the local writer service to start or release its previous lock; mailbox writes still require that service. A validated host record starts the local preview in its exact open note before disk and note-location checks finish. Those checks still precede adopting a writer job or requesting a final-save grant. Saved previews in open notes are checked by their exact response IDs before general catalog discovery, including completed turns that have left the active catalog. These checks retire restored live previews when the host confirms completion. Network and authentication time still apply; writer grants and checked final saves remain unchanged.

New replies use one complete response container after the host advertises support. Its permanent ID and saved empty placeholder locate the answer and controls after outside edits, note switches and reloads. Separate response HTML comments are no longer inserted. The container syntax is hidden in Live Preview, Source mode and Reading view; it remains in raw Markdown for safe updates. The owning device replaces only this response and preserves surrounding text. Existing replies and older hosts keep their original comment format until checked completion. The plugin remembers generated versions so an older generated block arriving through Sync can catch up. While tracked, response contents belong to T3: changes inside an intact response block are overwritten on the next update, including Sync duplications. Removing or damaging the tracking boundaries stops insertion into that destination; the answer remains available in T3. Replies update the live editor when open, or the vault file when closed. Each write rechecks ownership and current note contents. Replies started under the previous host-only implementation still finish on their original host; older device-local replies also overwrite changed active contents. Prose remains in a blockquote; headings, top-level tables and fenced code blocks render outside it so they work in Live Preview. While text streams, its unfinished block stays literal. Completed blocks render as normal Markdown; the final reply restores the full Markdown layout. Selecting text inside a fenced block places the response after the closing fence; an unclosed fence must be closed first.

Disconnected responses reconnect automatically once their T3 connection and vault host are available again. The saved user-message ID keeps recovery tied to the original response even if you continue chatting in T3 before Obsidian reconnects. When the original turn has fallen outside the recent 20-turn polling window, the plugin reads the complete canonical history and recovers only an unambiguous original turn. Completed historical responses use their durable completion checkpoint and final message ID. Projects without Git checkpoints can also finish recovery when the complete canonical transcript shows finalized assistant messages before a newer user-anchored turn. A newer running turn does not leave an older answer stuck on Working. Recovery uses the existing request and response block; it never sends another prompt. Ambiguous history remains tracked for a later retry, and edits inside the response remain protected.

If T3 fails a turn, the tracked response shows the reason reported by T3, including a usage-limit message when T3 provides one. It remains recoverable. In the editor menu, **Continue T3 response** sends exactly `Continue.` as one new turn in the same thread and streams its answer into the existing response with one click. **Attach latest T3 continuation** binds a newer turn already started in T3, after checking that its user message belongs to the same thread. If the note moved, either action can recover the response when its original path is gone and its response boundaries are intact. Both actions replace changed contents inside that tracked block. A lost send acknowledgement ends that continuation attempt and records its delivery status in the send failure log. If T3 resumes the original turn after a server restart, that turn can finish in place without a new message. The plugin does not repeatedly send requests while a provider limit is active.

The **Codebase view** tab in the left sidebar shows projects linked to vault folders, excluding self links to the vault. Expand a project and its folders to browse the workspace. Markdown uses Obsidian's native editor and reading view. Code uses separate native views named `typescript`, `javascript`, `json`, `css`, `python`, `c`, and `plaintext`, with local language highlighting and code indentation. Python source, windowed source, and typed stubs (`.py`, `.pyw`, `.pyi`) share the Python grammar. C source and headers (`.c`, `.h`) use the C grammar. Grammars load only for matching code files; ordinary Markdown editing receives no language extensions or code checks. Files above 300,000 code units use plain text. Images and PDFs use Obsidian's normal viewers. Text edits save to the T3 project through its existing authenticated connection. No project file or attachment folder is created in the vault by response delivery; ZIPs are not imported or extracted. Old imports remain until explicitly moved with the cleanup command described in [the bridge design](docs/codebase-bridge.md). See [language view behavior and compatibility](docs/language-views.md).

Project references use ordinary links such as `[[report.md]]` and `![[chart.png]]`. Existing vault links take precedence. Opening a project link shows an animated **Opening filename…** notice during lookup and loading. The notice closes when the native view opens, the file choice is canceled, or opening fails. The spinner respects reduced-motion settings. Project matches use the source note's linked folder; duplicate names require a choice. The plugin keeps file identities and remembered choices in synced metadata, outside note text. Right-click a Codebase file to copy its wikilink. Refresh updates expanded folders; open clean text files are checked every 15 seconds. Known unavailable project links never create blank vault notes.

Save checks compare the current project text with the text loaded by the editor, then verify the written text. Conflicts and failed saves retain a device-local draft. Use **Review unsaved project edit** to compare that draft with the current project file before choosing a version. T3's existing write API has no atomic compare-and-swap, so concurrent external writes can still race between these checks. Complete text reads are limited by T3 to 1 MiB; truncated or byte-inexact reads cannot be edited. Binary edits, project file rename/delete, unsupported native formats, and native mobile verification are outside the verified scope. See [the bridge design](docs/codebase-bridge.md).

Streamed updates preserve the editor's reading position by default. Use the double-down-arrow **Follow response** button in a running response block to follow it. The button moves from the upper-right corner to the lower-right corner during a 420 ms scroll, then pops into place and glows Obsidian purple. The rendered block's bottom stays 8 px inside that pane's visible space, including later layout changes. Click again to stop: the button always returns to the upper-right corner and its normal icon color, while the viewport stays in place. Clicking elsewhere, selecting text, editing, or scrolling manually also stops following; response text clicks and scroll position never enable it. The button is available in Live Preview and Reading; changing to Source ends following. Each pane starts with following off, and completion or a view-mode change clears the choice. An active response offers **Stop T3 response** in the editor menu, which immediately seals the visible response before contacting the host: the received text is preserved, the working indicator and tracking tags are removed, and the Stop action disappears. Cleanup works even when T3 is unreachable or the stream state is missing, and Stop is also available on failed responses alongside continuation controls. Pending question prompts are preserved as text while their response controls are removed. Interrupting the bound T3 turn happens independently; stop requests that this device cannot deliver are retried while Obsidian is open and after reopening. Remote interruption remains best effort. Late stream events cannot resume a stopped response. Command approval prompts show small **Approve** and **Deny** buttons on the **Action needed** line in Live Preview and Reading view, with the requested command beneath it when T3 supplies it. Approve allows this request once; Deny rejects it. Any authenticated device connected to the original thread machine can respond. Buttons remain disabled while T3 applies the decision and disappear when the request resolves, including when answered from another device. A lost connection offers **Retry approve** or **Retry deny**, replaying the exact saved decision; the plugin never automatically submits or retries an approval. Other approval types remain in the T3 app. Stopping a response removes its approval controls while preserving the command text. Questions can be answered directly in Obsidian as described below. Full reasoning traces and tool payloads are not copied into the note. Before dispatch, the sending device registers its response through the existing authenticated T3 connection. This does not wait for the note or response marker to sync to the VPS. The device receives T3 updates directly and writes the actual Markdown locally; there is no separate response display.

For threads on a connected remote computer, the writing device does not need its own T3 Code app or local server running. Obsidian and this plugin must remain active, and the thread machine must remain reachable. Local-only threads still require their local T3 server. These requirements also apply to question controls and continuation actions.

The vault connection machine must keep Obsidian and this plugin running to grant ownership and accept heartbeats. It stores requests, ownership epochs, and known response versions under `.obsidian/t3-code/inline/v1/` (or the configured settings directory). Clients reach these files directly through T3; they contain no credentials and are not carried through Sync. A filesystem lock admits one coordinator, which serializes claims. Each writer checks a conservative local deadline immediately before note mutations, and checkpoints generated versions before inserting them. A completed editor reply stays recoverable until Obsidian has saved its final Markdown to disk. Independent jobs and heartbeats keep slow threads or downloads from blocking other notes. Unchanged progress does not rewrite the note. A lost coordinator connection stops writes once the grant expires; it cannot authorize a second writer offline.

The send modal closes immediately while delivery continues in the background. Validation failures reopen the draft; delivery failures show a notice without taking over the editor. If registration fails, the new stream ends immediately and the send failure log records the failed stage. Install/reload the updated plugin on the vault connection machine and each device that should participate. Changing the default machine affects new jobs; existing jobs retain their original coordinator.

The editor menu can request **Stop T3 response** from a synced device. Even an orphaned response block can be cleaned up on the current device. Remote interruption of an older device-local job requires its original device and connection. The agent owns the contents of an active response block until it finishes. Changed text inside intact tracking boundaries is overwritten with the latest T3 output; changes outside the block are preserved. Previously paused bindings with intact markers can recover after reload or writer takeover. Removing or damaging a response boundary prevents replacement; restoring the boundaries lets the open editor catch up. Completed, finalized responses remain editable and are no longer rewritten. Remove abandoned response markers/blocks when they are no longer needed; independent responses can coexist.

## Folder links

Right-click a folder and choose **Link to T3 Code → Link to <project>**. Confirm the link in the dialog. Links appear under **Settings → T3 Code → Linked folders** and route manual chat and note sends. Saving a link alone does not send notes.

**Unlink**, directly below **Create T3 project…**, removes only the selected folder’s direct link. It is disabled when that folder has no direct link, including when it inherits a parent link. Parent and nested links, T3 projects, files, and remembered conversations remain unchanged. After unlinking, the folder can inherit its nearest parent link. Unlinking does not require a T3 connection.

**Create T3 project…** opens a workspace picker on desktop and mobile. It remembers the machine and parent directory from the last successful project creation or external project link, and opens that directory automatically. Switching machines restores that machine’s last parent directory. The choices sync with the vault; local desktop choices remain tied to their original machine. Existing external folder links supply an initial default without a migration write. If the remembered machine is unavailable, the picker uses an available machine’s own remembered directory or home folder.

**New folder** is selected initially and proposes a child folder named after the project. Edit **Folder name** to use another directory name, or select **Existing folder** to use an existing workspace. The full workspace path appears above **Create and link**. Type a path and press Enter or select **Go**, or use **Home**, **Up**, and the compact folder rows. **Filter folders** searches the current list without another network request. Hidden directories are omitted until **Show hidden** is selected. The folder list scrolls independently to keep the actions accessible. The directory and T3 project are created only on final confirmation. Browsing or cancelling changes neither the saved default nor the folder link. An existing registered project is reused in existing-folder mode. The workspace must be outside the Obsidian vault. Explicit **New project** sends from unlinked folders use this picker; a successful project creation remembers its parent even if the subsequent send is cancelled. Existing links and remembered threads are not migrated.

Shared preferences use a field-level three-way merge against the last adopted snapshot. Distinct nested edits merge; simultaneous changes to the same field prefer the current disk value. Arrays are atomic, while folder links, note history and delivery relations use their own merge protocols. Project selection toggles are retired. Folder links sync with the vault. T3 credentials remain device-local. Each explicitly linked folder shows the **T3 logo followed by its linked project name** beside the folder name in the Files explorer on desktop and mobile. Other descendants remain unmarked. Long project names truncate to fit the sidebar, with the full name available in the tooltip and accessibility label. The indicator updates when links are added, removed, renamed, or synced.

### Sending notes into linked projects

**Send to agent** uses Smart Send for every note. It sends only text added since confirmed delivery to that particular thread, in note order. Deleted text produces no message or change label. Agent replies, generated history, and input echoes are excluded. A selection limits the source to that selection. A different or new thread has its own sent-text record. Hold Control while activating it to open the compact project/thread selector, with **New thread** and **Existing thread…** choices. Mobile also has an explicit **Send to agent: choose destination…** action. The existing-thread option loads a searchable list of that project’s unarchived threads, newest first, with each thread labelled **Active** or **Idle**. All three thread actions use the displayed project; when there is no remembered project, nested links take precedence. The command palette uses the same automatic default and Control-to-select behavior for every note. Browsing existing threads for a new folder project does not create it; if no project exists yet, use New thread. A missing linked project reports an error instead of rerouting the note.

**Ask agent…** opens a wide rounded composer at the bottom of the note. The editor menu captures the selection; the note menu uses the current note. The command bar remains a direct Ask surface: type a question and submit as before. All Ask surfaces use the same Smart Send record for their accompanying source. Your typed question always sends, including repeated questions. An Ask about previously sent source includes a short selection reference. Explicitly selecting an agent reply lets you quote it as Ask context. The old floating mobile selection action is removed.

If the previous thread has no new source and there is no typed question, normal Send opens the project/thread selector with only **New thread** and **Existing thread…**. The previous/continue action is hidden. Choosing a thread that also has no new text shows **Nothing new to send** and sends nothing.

Smart Send is the normal send flow; there is no beta switch. Tracking and compressed response text live in the plugin’s synced `data.json`, with a device-local replica. Completed notes receive no new hidden boundaries. Each response body is stored once by its content hash; large bodies and current source snapshots use gzip when that reduces size. Confirmed records merge independently, so concurrent device records are retained. Sync does not serialize simultaneous sends on different devices.

Smart Send excludes valid hidden run-import receipts from outgoing text. The receipts stay in the note for duplicate detection. Literal receipt examples inside code remain ordinary source text.

Changing emphasis, strikethrough, quote prefixes, or callout type/folding does not resend unchanged text, including saved agent replies. New text keeps its Markdown formatting. Code, URLs, numbers, custom callout titles, and task states still count as content changes.

### Previous thread

After every confirmed manual Send or Ask, the plugin remembers that thread as the note’s default for its next send. **Previous thread** means the last thread used from this note. This happens automatically, including when choosing a new or existing thread; there is no remembering toggle in the dialog or settings. An unconfirmed send does not change the default. Use **Existing thread…** to choose another conversation from the selected project.

Thread history syncs in plugin settings and contains note paths, project destinations, and thread IDs, but no note body or credentials. Renaming a note moves its history; deleting it retires the records. History mutation revisions advance monotonically independently of last-used ordering, including move-back and clock rollback. The previous thread must still exist in its original T3 project. If that project is unavailable, the plugin reports the problem instead of rerouting the send. Notes are kept when a manual send completes.

Existing history and requests saved under the former note-thread-link terminology remain usable. Older sends without a unique recorded note path cannot be identified reliably by title alone. The plugin recovers a remembered destination from a confirmed completion job when its note and project still exist. Folder linking remains separate and continues to supply the default project.

Each destination receives only its unsent source and the images embedded in that source or your typed question. Existing-thread sends preserve its model, runtime permissions and interaction mode. An idle thread starts another turn; a running thread receives input through T3’s steering behavior. Resolve pending approvals or structured input in T3 before sending another note. Retries reuse the original thread and message IDs without creating a new thread. Every confirmed manual note send keeps the note and supersedes any older cleanup job for it.

**Settings → T3 Code → Threads → Settle completed threads** is on by default. After a successful Obsidian turn, the plugin moves its T3 thread from the active list to the Settled shelf. A streamed answer must finish saving into its note first. Checks run every 30 seconds while the sending Obsidian client is open and resume after a restart. Pending approval, requested input, live background work, failed or interrupted turns, and turns superseded by later activity do not trigger settlement. Only threads sent by this plugin are affected. A later send to the same settled thread automatically wakes it and preserves the note’s remembered destination. Turning the setting off cancels pending settle checks; later sends remain active. Settling does not archive or delete the thread.

## When task completes

Manual sends always keep their note because each confirmed thread becomes its next default destination. The **Orchestration → Legacy cleanup defaults** settings remain available for previously queued cleanup jobs: **Keep note** (default), **Archive note**, or **Delete note (vault trash)**. Archive has a configurable vault-relative folder, defaulting to `Archive/T3 Code`; it preserves the note’s original subfolders and adds a numeric suffix if a destination already exists. Delete moves only the Markdown note to this vault’s `.trash`; embedded image files remain in place.

The plugin polls the destination T3 environment every 30 seconds while Obsidian is active. Mobile can suspend the app; checks resume when reopened. The completion signal is the original sent turn reporting `completed`, with its session idle (ready or stopped), no pending approval/input, and its original user message and final assistant message verified. This is a T3 lifecycle signal, not a judgment that the answer fully solved the task. Failed/interrupted turns and conversations that have advanced to additional turns keep the note.

The completion action and note fingerprint are saved when sending. Later setting changes affect new sends only; retries preserve the original action. Monitoring resumes after Obsidian restarts and retries connection errors. **Task completion monitoring** shows status and offers **Check now**, **Stop monitoring**, and **Dismiss**. Starting a newer send for the same note supersedes its previous cleanup action once that send is confirmed.

Notes edited, replaced, renamed, or left with unsaved editor changes are kept. Archive/delete runs in the sending Obsidian vault, including when the T3 thread runs on another computer. Existing notes and previously sent threads are not automatically enrolled.

The **Final answer format** setting under **Inline responses** defaults to **Current formatting**. **Raw Markdown** inserts only each verified completed final answer without added blockquote prefixes; while a turn is running, its paragraphs retain current formatting. Intermediate responses remain in the progress box, and questions, steering controls, status, timers, and tool activity keep their existing presentation. Both formats share project file reference resolution and literal-HTML protection. The choice is saved per response, including independent destination bindings, and survives reloads, writer takeover, continuations, and question answers. Setting changes affect new responses. Raw-mode responses require an updated writer; older clients cannot take them over.

## Embedded images

Full-note sends and Ask T3 questions use the same image packaging. Only images embedded in the selected passage or question are attached; unselected note content is not sent.

Supported embeds: `![[image.png]]`, `![[folder/image.png|300]]`, `![alt](relative/image.png)`, reference-style Markdown images, HTTPS image URLs, and base64 image data URLs. Local links use Obsidian’s resolver relative to the source note, including attachment folders and percent-encoded paths. Images inside code blocks, inline code, frontmatter, and escaped wiki embeds are ignored.

PNG, JPEG, GIF, and WebP bytes are uploaded through T3’s native attachment API. Each original embed is replaced by a native `t3-context://` reference, so the image stays at that point in the message. Repeated images reuse one attachment; all other Markdown is unchanged. Neither the note nor its images are moved or modified in the vault. HTTPS downloads use Obsidian’s `requestUrl` with no access key or authorization headers added. Mobile downloads are buffered by Obsidian before the byte limit can be checked; for large remote images, download a resized copy into the vault first.

Limits: 8 distinct images, 10 MiB per image, 20 MiB combined, and T3’s 120,000-character prompt limit. Missing images, failed downloads, HTML `<img>` embeds, unsupported formats such as SVG/HEIC, and limit violations stop the send with an error instead of silently omitting images. Convert unsupported formats to PNG/JPEG first. Non-image wiki transclusions (notes/PDF/audio) remain as Markdown and are not expanded. Image-only notes work.

The plugin includes image support. The selected T3 model/provider must accept image input. Direct pairing is verified against T3 0.0.43-nightly.20260917.1866; local integration was also tested against 0.0.43-nightly.20260916.1811; recheck compatibility after T3 upgrades.

## Empty states and recovery

Empty notes are rejected without creating a thread. Unlinked note sends offer an explicit new containing-folder project and No project even when no projects are selected in settings. Linked-folder sends and palette chat use their folder association or No project machine independently of the project-menu selection toggles. Failed scans report the error and preserve the last discovered list; unavailable selections are retained for later rediscovery. Sending to a removed project reports an error without scheduling delivery.

The in-flight command identity is saved before dispatch. During sending, additional sends are disabled. Failed sends remove that local request and its new response displays immediately. Cleanup runs independently through the host and interrupts only a turn bound to the exact failed message. No Retry or Discard queue remains. Restarting Obsidian closes old unresolved attempts and does not resend them. A lost acknowledgement can mean that T3 accepted the work; the failure log records delivery as **not-started**, **unconfirmed**, or **accepted** rather than claiming that a network failure undoes remote work. The device retains the last 64 failures, including stage, request/thread/message/binding IDs, elapsed time, redacted error stack and nested transport cause. Message bodies and credentials are excluded. Open **Send failure log** in settings or run **Export send failure log** to copy the JSON. General stream logging remains disabled.

Pending requests store the full note and base64 image bytes in local IndexedDB until confirmed/discarded. Direct mode stores the complete immutable commands in device-local IndexedDB before dispatch, without a server-side plugin journal. Local desktop integration keeps a private request journal under the T3 data directory (`send-to-t3-code/desktop`). Journals retain prompt/image bytes to retry exactly; they contain no session credentials. In local mode, T3 credentials are issued through its official CLI and revoked after use. Direct pairing sessions stay in device-local app storage. Official CLI output is bounded and each CLI operation times out after 45 seconds. Note contents and image payloads travel in authenticated HTTP request bodies, never shell commands or CLI arguments.

## Agent folder routing commands

Agents can inspect, link, deliberately relink, and unlink existing vault folders through the same private command mailbox used for note sends:

```bash
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  --request-id INSPECTION_UUID inspect-folder 'Projects/Side/handoff'
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  --request-id LINK_UUID link-folder 'Projects/Side/handoff' \
  --project-id PROJECT_ID --connection-id CONNECTION_ID --environment-id ENVIRONMENT_ID
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  --request-id UNLINK_UUID unlink-folder 'Projects/Side/handoff'
```

Use verified project and machine IDs. The connection ID is an exact configured paired connection or `local` for this desktop. Linking verifies the authenticated machine and live project catalog, then saves through the UI's folder-link logic and refreshes its T3 indicator. Titles and workspaces come from the project catalog. It never creates a project, starts a thread, or sends a note. `--mode self` requires an existing project at the exact vault folder; paired self links also verify the vault identity and synced directory on the vault connection machine. The vault root is no longer a project link; configure its vault connection in settings.

Replacing a different direct link requires `--relink`. Unlinking affects only that direct link; nested links, source files and remembered conversations remain. Results expose `directLink`, nearest inherited `effectiveLink`, vault identity, and `routing`. An unlinked folder reports `no-project`; linked folders report `linked-project`. Legacy root associations do not supply a project destination. Inspection reads saved links and does not prove current connectivity.

Folder edits also save per-folder change records and unlink tombstones through normal settings Sync, with a device-local copy to recover stale whole-file replacements. Newer explicit edits take precedence. Reload the updated plugin on other devices before editing folder links there.

Retain immutable request UUIDs and exact arguments. Replaying returns the original acknowledgement; use a fresh UUID for current inspection. After timeout replay the same UUID, and after fixing a failure add `--retry`. Prepared mutations recover lost acknowledgements without overwriting later links; unavailable or invalid destinations preserve the previous link. Credentials stay device-local and never appear in results. See [the agent skill](docs/obsidian-t3-SKILL.md) for the complete workflow.

## Development and release pipeline

Implement and test in the current thread's source worktree so parallel tasks keep separate edits. `/home/ubuntu/projects/send-to-t3-code` is the integration and release checkout; integrate reviewed commits there before packaging. Source worktrees are separate from both installed copies:

- `/home/ubuntu/Obsidian Vault/.obsidian/plugins/send-to-t3-code` is the development-vault installation and contains only runtime artifacts plus its local `data.json`.
- `/home/ubuntu/vaults/QLO2/.obsidian/plugins/send-to-t3-code` is the QLO2 installation published by Obsidian Sync.

Requires Node.js, npm, and Python 3. Run `npm ci`, then `npm test`. Checks select changed systems and their transitive consumers, build when needed, and reuse successful results for identical test inputs. Build output is `dist/main.js`; checks never install into a vault. The plugin registers Obsidian's vault/metadata events and editor/file menus. See [Obsidian plugin setup](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin).

For a release, commit the reviewed changes in the task worktree and run `npm run release:qlo2 -- --enqueue HEAD`. Each source commit gets one durable FIFO job. Read it with `npm run release:qlo2 -- --queue-status JOB_ID`. A single worker owns canonical integration, final version assignment, affected validation, packaging, installation, Sync, and the native QLO2 reload. Task threads do not edit the canonical checkout, reserve versions, contact sibling threads, or negotiate release turns. Install the event-driven worker once from the canonical checkout with `npm run release:qlo2 -- --install-queue`; it uses a systemd path unit rather than periodic polling.

Supply retained changed-behavior evidence with `--enqueue HEAD --evidence PATH --notes "WHAT WAS VERIFIED"` when available. The worker can complete smoke automatically if the touched source inputs remain identical after integration. Otherwise the job holds its release slot at `awaiting-smoke`; its owner verifies the changed behavior and records `--complete-smoke` in the canonical checkout, which wakes the next queued job. Other threads submit their work independently and inspect only their own job. No thread discovery or agent messages are used. Failed jobs preserve their position and immutable archives; `--retry-queued JOB_ID` retries the same job. If packaging has not started, `--retry-queued JOB_ID --replacement HEAD` accepts corrected reviewed source in the same slot while retaining the original request. New behavior evidence must be supplied for changed code. Once an archive exists, retries must resume its original bytes.

Queue requests, states, evidence, and logs are outside synced vaults under `/home/ubuntu/projects/send-to-t3-code/evidence/release-queue`. Clean-checkout checks, a worker lock, and the common release lock protect canonical work. Concurrent submissions are idempotent; a second worker cannot publish. The worker restarts before validation if integration changes release tooling. It never resets or discards unrelated canonical edits.

For an optional candidate check before submission, use `npm run release:qlo2 -- --prepare --bump patch` (or `minor`/`major`). Commit the final checked bytes and enqueue with `--validation PATH`. This is not the concurrent default because normal jobs let the queue assign versions. A matching prepared candidate is packaged without another build or test run. Source, dependency bytes, runtime, installed-release baseline, bundle hashes, and saved test evidence must match; otherwise publication is refused. Repeat interrupted preparation with `--prepare --version VERSION`; unchanged successful checks remain cached.

`npm run test:plan` prints the changed files and selected test files. Selection follows both current and previous dependency graphs, so removed imports and deleted source still affect consumers. Imports, exports, bundle reads, embedded esbuild imports, and local Python imports are included. Add explicit runtime or generated dependency edges in `scripts/test-impact.json` where static paths cannot express them. Changed executable source with no path to a test stops validation. Version bookkeeping and documentation do not select unrelated tests. Test-runner, build configuration, or dependency changes can affect all tests. `npm test -- --base COMMIT` supplies a development baseline; release preparation always compares against the installed release source. `npm run test:all` is available for an explicitly requested full diagnostic run.

Checks and logs are retained outside synced vaults under `/home/ubuntu/projects/send-to-t3-code/evidence/checks`. Build, source, dependency, and test-input hashes control reuse. Failed checks and inputs changed during execution cannot create successful cache entries. Documentation-only and release-tool-only changes require affected checks and source integration, not a plugin release, unless deployment is needed to verify the tooling itself.

Before queue installation, the legacy one-step `npm run release:qlo2 -- --bump patch` command uses the same affected checks. Once the worker is installed, direct CLI publication and resume are refused; submit or retry the queue job instead. Publication creates a new immutable archive, installs only runtime artifacts in the development vault, backs up QLO2, preserves `data.json`, installs atomically, pauses continuous Sync, forces a fresh one-shot scan, requires `Fully synced`, and restarts continuous Sync. It refuses an existing archive/receipt and a version that is not newer than QLO2. Prepared publication requires clean committed source. The legacy one-step command allows `--allow-dirty` only with explicit user authorization.

If an immutable archive was created but installation or Sync failed, use `npm run release:qlo2 -- --retry-queued JOB_ID`; the worker resumes those exact bytes. The legacy `--resume VERSION` command applies only before queue installation. Never delete and recreate a versioned archive with different contents.

Only when the user explicitly requests skipping the affected tests, add `--skip-tests-reason "EXACT USER INSTRUCTION"` to a one-step release command. The build still runs, and immutable provenance plus the deployment receipt record the skipped checks and reason. This option does not apply to preparation, prepared publication, resumes, or smoke completion.

The deployment receipt is intentionally marked `awaiting-live-smoke`. Publication automatically queries the real QLO2 client, invokes its native reload command, and requires a new instance at the released version while preserving both plugin settings files. It records `client-check.json`; if the client is unavailable, use `npm run release:qlo2 -- --check-client VERSION` to retry without reinstalling. This common check proves reload and the loaded version, not changed UI or delivery behavior. Check changed behavior once in its relevant test vault/client and reuse that evidence for the same candidate. Do not repeat unrelated manual checks. Do not create or store smoke-test notes, folders, attachments, screenshots, logs, reports, or other evidence in QLO2, even temporarily. Keep all evidence under `/home/ubuntu/projects/send-to-t3-code/evidence`, outside synced vaults.

Always delete all temporary smoke-test T3 threads and notes after use, including failed, cancelled, and interrupted tests. Track their exact thread IDs and note paths, save durable evidence outside the vault, stop active test work, and delete through native T3 controls and Obsidian's normal vault operations. Archiving threads or closing tabs is not deletion. Verify deletion before reporting the test complete or completing the smoke receipt; report any cleanup blocker and remaining IDs/paths. Preserve pre-existing user threads and notes, and immutable evidence.

After this cleanup, complete the release with:

```sh
npm run release:qlo2 -- --complete-smoke VERSION \
  --device DEVICE \
  --evidence /absolute/path/to/evidence.png \
  --notes "Exact behavior verified"
```

A change is not live or complete until that immutable smoke receipt exists. Backups and receipts live outside the synced vault under `/home/ubuntu/projects/send-to-t3-code/evidence`. Direct `scripts/deploy-qlo2.py` use is retired so old instructions cannot bypass versioning, tests, packaging, or smoke evidence. Do not route QLO2 installation through the Windows laptop.

The optional laptop update hook uses the plugin's private command mailbox over
Tailscale SSH. Configure it once with `python3 scripts/laptop-reload.py --install`.
Each published immutable receipt starts the existing reload service without waiting for SSH; a user timer retries
when the laptop is offline. QLO2 must be open with a version containing the client
maintenance commands (one initial native reload is needed when upgrading from an
older version). `client-status` reports a per-load instance ID and the version
embedded in the running bundle. `reload-client` requires the exact release version
and SHA-256 hashes for all three runtime files, waits for Sync and saved ordinary
edits, and invokes Obsidian's **Reload app without saving** after its acknowledgement
is durable. A new instance reporting the target version supplies the loaded-version
receipt; an acknowledgement alone leaves the update pending. Release smoke testing
stays on the VPS. The hook never closes or force-kills Obsidian, copies plugin files
to the laptop, or changes its `data.json`.

Git tracks the TypeScript source, tests, release tooling, and dependency lockfile. Generated `dist/`, packaged releases, local validation artifacts, and Python caches are ignored.

This is a local community-plugin-format build; it has not been submitted to or approved for the public community directory.

The browser-targeted bundle includes portable hashing and binary utilities. Desktop Node imports live in `desktop.ts`, loaded only after a platform guard. Tests evaluate the built bundle without `process`, global `Buffer`, or access to Node modules, then send an image note through mocked Obsidian APIs. This is a compatibility test, not a substitute for testing on an actual iPhone/Android device.

Release 2.3 passes 32 automated tests covering native email verification, wrong-code/expiry errors, credential rotation, device-bound proof verification, automatic multi-machine connection, partial offline recovery, renewal coalescing, sign-out and cancelled verification. The built mobile bundle is tested without Node APIs. Live desktop validation records are kept locally in the ignored `evidence/` directory; actual iPhone/Android verification remains separate.

Live 2.3 validation in QLO2: one email verification connected both laptop and VPS, plugin reload preserved sign-in, and Files-pane right-click sends to both hosts completed with two correctly recognized images. Original user settings were restored and test notes removed.



Version 2.8.1 adds the new/existing-thread choice to command-palette chat and labels existing-thread choices **Active** or **Idle**. Active threads remain selectable and use T3's steering behavior. All 87 automated tests pass.

Version 2.8.2 separates the destination filesystem path from the vault-relative path. A same-connection vault-root link maps synced mobile notes to their destination path; without a safe mapping, chat sends the vault name and relative path once rather than duplicating it.

Version 2.8.3 adds live **T3** badges to explicitly linked folders in Obsidian’s Files explorer and clarifies that command-palette chat never triggers archive or delete completion actions.

Version 2.9.0 adds machine selection and remote vault-project setup through existing T3 connections. Synced identity verification supports different vault names and paths across computers. Mobile can browse the selected computer, reuse or register its vault project, and continue the original chat. File access uses T3's authenticated WebSocket API; project creation uses its existing orchestration API. No server-specific hostnames or filesystem paths are embedded in the feature.

Version 2.9.1 replaces the colored folder badges with the T3 logo and linked project name. The label follows the Obsidian theme and truncates long names to fit narrow sidebars.

Version 2.9.2 fixes new threads inheriting a recent conversation's model and reasoning effort. Desktop and mobile now read the selected machine's current T3 settings through its authenticated connection, respecting project overrides and automatic model selection. This applies to command-palette chat, note-menu sends, and tag sends. Existing threads and saved retries retain their original selections.



Assistant response HTML outside code is displayed literally so tag-like placeholders cannot disrupt Obsidian Live Preview. Markdown paragraph quotes, inline and fenced code, and URL/email autolinks retain their formatting. This is renderer-side processing; agent prompts are unchanged.

### Plugin logging disabled

Desktop reply credentials have a focused local audit at
`<T3 base directory>/userdata/logs/obsidian-stream-auth.jsonl`. It records credential
IDs, lifetime, component, closure reason and caller, rejection and recovery;
it excludes tokens, prompts and response text. Two private files are capped at
256 KiB each. Writes occur only on credential events, with no timer, vault write,
Sync publication or remote upload, and audit failures do not block delivery.
The general plugin diagnostic logger described below remains disabled.

General plugin diagnostic logging is disabled for a performance isolation test on all
platforms. No general diagnostic journal, operation instrumentation, logging listeners,
persistence timer, Sync publication, or remote upload runs. On startup the
plugin clears this vault's old device-local diagnostic buffers and removes the
shared `t3-code-log.json` from its configuration folder. It also removes only
plugin-generated Markdown logs in `T3 Code Logs`, preserving unrelated files.
The **Export plugin diagnostics…** command reports that logging is disabled.

Each device must reload this release after Sync to stop its previous logger.
Request queues, credentials, subscriptions, and response recovery remain intact.
Obsidian's own Sync logs are separate from plugin diagnostics.

The response host owns its shared credential; stopping one response releases
borrowed access without revoking the credential used by other responses. A
rejected reply read refreshes access immediately and retries once; concurrent
readers share that refresh. Delayed failures from an old credential cannot close
its replacement. Repeated authentication rejection backs off, and dispatches
are never replayed by read recovery.

## Multiple streaming destinations and agent commands

### Import an existing T3 run

With a Markdown note open, choose **Import T3 run into this note…** from the
command palette or editor menu. Select the source project and machine, thread,
then response. The preview shows its prompt, date, status and destination.
Confirming imports that response without sending a prompt or changing the
note's project routing. The confirmation closes immediately while importing,
final saving and optional thread following continue. Notices report the result,
including pending saves or errors. A running response catches up with output
already in T3
and streams until completion. Repeating the import reuses its existing binding,
including after completion, reload and later note edits.

System messages and provider notices, such as background-command completion
notifications, are excluded from the run list and thread following. This uses
T3 origin metadata; a real user or agent prompt can quote the same notice text
without being hidden.

**Follow future runs in this thread** is off by default. Enable it to import
every response after the selected run, including responses that have already
finished, and continue streaming new responses to this note. Runs before the
selected run are excluded. Reimporting with follow enabled also catches up
responses skipped by an older or paused registration without duplicating
existing responses. **Manage T3 streams in this note…** lists these registrations and supports
pause, resume and removal from this note. Already attached responses finish
normally. Resume skips runs started while paused. For a registration shared by
several notes, pause/resume affects all its destinations; removal affects only
the current note.

Import requires exact prompt-to-run evidence and a verified lifecycle. Saved
response checkpoints can supply older associations missing from the current T3
snapshot. Missing associations or completion records appear as **Unavailable**
with an explanation; the plugin does not guess from message order or import an
unrelated latest run. Arbitrary old T3 history without these records still needs
additional historical data from T3. Source machines and the vault response host
must be reachable. The destination must already exist; imported content follows
the normal response presentation, file import, ownership and checked-save rules.

Several T3 threads can stream into separate response blocks in the same note. One response can also stream into several notes. Each binding has its own ID and destination; mirroring does not send another prompt. Choose **Send note with streaming destinations…** in the command palette and enter existing vault-relative Markdown paths, one per line. This creates one new thread from the current note and mirrors its response into those destinations.

Active replies follow note and folder moves within the vault. If a client misses the rename during Sync or a restart, it finds the existing response by its tracking ID and continues in its new location. A healthy writer retains ownership while waiting for a moved note to arrive through Sync. Moving the note does not start another thread or recreate the old path. Verified native renames retain local output immediately and send a saved relocation handoff to the host before waiting for Sync. Exact stale saved copies at former paths have their active markers retired after an external backup; changed copies remain protected. An ambiguous duplicate shows a blocked warning with the candidate paths. Use **Review response destination…** to choose the intended note: recovery backs up each candidate, preserves its text, detaches competing active markers, and catches up with the existing T3 reply without resending the prompt.

When a note has one running response, ordinary Ask and palette follow-ups steer that response, including selected text outside its block. **Send to running thread** remains available on another device even without remembered thread history. **New thread** always creates an independent block. With several running responses, Ask inside a block steers that response; select text elsewhere and choose **Ask T3 in this response** to target a specific block. An unscoped Ask with several running responses creates an independent block. Menu entries identify each block by its short response ID; clicking inside a block scopes its controls. **Stop T3 response** immediately finalizes that note block and separately requests interruption of the underlying T3 turn, so other mirrors observe the interruption when it reaches T3. Removing one block stops writing to that destination and preserves other destinations.

Replies retain the exact prompt message ID, turn-start timestamp, ordered provider-session evidence, and established message-to-run bindings in their hosted checkpoints. A later snapshot, reconnect, reload, or writer takeover preserves those bindings. Direct sends also persist the acknowledged start request when the live event feed missed it. If canonical timestamps cannot prove that binding, the desktop freshness check requests a bounded replay through T3’s supported thread-subscription interface, retaining only exact binding evidence. A replay gap that exceeds T3’s event limit remains unresolved. Ordinary messages delivered during a running turn follow that existing run only after subsequent run evidence; an exact new primary run takes precedence in a completion race. A prose interval or arbitrary latest run is never enough to bind an unmatched reply. If authoritative evidence is unavailable or ambiguous, the response remains tracked for recovery.

Reading view uses native local response projections with an updated host; only checked final materialization reaches disk. Older hosts use atomic vault writes instead of a hidden editor buffer. Desktop freshness checks use native coordinator ticks even when the live feed stops or renderer timers are suspended. Those ticks also bound the writer's history reads and asset imports, freeing a hung worker for a bounded retry and fencing its late result. This does not establish a transport or timer cause for the original reported delay.

Completed native responses remove the entire container in their checked final save and become ordinary Markdown. Legacy writers use temporary `t3-response` comments until Obsidian saves the answer; they then record durable completion evidence outside the note, remove the comments, and verify that cleanup also reached disk. Recovery survives reloads and another stream changing the same note. Registration retries consult the saved binding record, so cleaned replies are never inserted again. Older completed replies with proof comments are cleaned on an eligible writing device after upgrade, preserving later user edits. Marker examples inside fenced or inline code remain ordinary response text and cannot block completion.

The vault coordinator keeps active bindings in each note on one writing device, and existing atomic note writes protect surrounding blocks and edits. All destinations belonging to a send must finish saving and cleaning up before its automatic settlement can run. Active streams and pending questions retain their recovery tracking; missing or malformed response boundaries prevent writes.

Agents with local filesystem access can use the source-checkout CLI while the desktop vault is open in Obsidian:

```sh
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py \
  --vault /home/ubuntu/vaults/QLO2 \
  send-note 'Projects/Task.md' \
  --destination 'Projects/Task.md' \
  --destination 'Projects/Summary.md'
```

The running plugin reads the note and embedded images, resolves its linked T3 project, registers each stream, and sends the prompt once. It returns JSON containing `threadId`, `messageId`, and `bindingIds`; acknowledgement confirms delivery, not completion of the agent’s work. Omit destinations to stream into the source note. `--no-stream` sends without inserting a response. `--thread-id ID` continues a thread instead of creating one. This uses the plugin’s existing authenticated T3 connection, without personal-fleet dispatch.

To attach an existing response without sending a prompt:

```sh
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py \
  --vault /home/ubuntu/vaults/QLO2 \
  attach-response 'Projects/Task.md' \
  --thread-id THREAD_ID --message-id USER_MESSAGE_ID \
  --destination 'Projects/Another.md'
```

The source thread and exact user message must belong to the source note’s linked project. Attachment catches up from canonical history, including completed replies. Existing notes are required; absolute paths, hidden paths and traversal are rejected. Up to 32 destinations are accepted per command.

Commands use a private local mailbox outside the vault. The checked `<configDir>/t3-code/storage-route.json` identifies its root; the relative mailbox path is `<configDir>/t3-code/commands/v1/`. See [response storage lifecycle](docs/response-storage-lifecycle.md). Keep the returned command `id`: use `--request-id ID` with identical arguments after a timeout to retrieve the same result. For a failed command, add `--retry` to retry its original saved prepared request. The prompt, attachment bytes and binding IDs are reused; a retry never creates a replacement turn. Pending commands resume when the plugin reopens. Request IDs cannot be reused for different arguments. Mailbox requests and results contain note paths and IDs; prepared prompt/attachment snapshots remain in Obsidian device-local storage only while delivery is unresolved. Confirmed or explicitly discarded commands keep their command identity and result/tombstone without the payload. Terminal local desktop ledgers keep request fingerprints and IDs, so replay remains idempotent. Legacy terminal snapshots compact on reload or replay.

Version 2.36.7 corrects Windows parent-path detection when the command bridge opens its private mailbox. The same check protects the private response journal. Paths inside a vault are still rejected. Load this release once on an affected Windows client; subsequent SSH status, failure-log and reload requests use its private mailbox. If the route has not been created, the laptop helper reports that initial load is required and does not write a command into the synced vault. Current releases invoke reload immediately; editor content and release hashes do not block it.

Send and Ask use the note name for new thread titles. `Untitled`, `Untitled 1`, and other numbered untitled notes let T3 generate a title. Under **Threads → Thread title generation**, choose **Always use T3** to generate titles for every new thread. Messages without a note also use T3 generation. Existing threads keep their titles, and their canonical name labels the response from the start.

Open editors follow T3 title metadata directly, so generated titles do not wait for an assistant message or a host response commit.

Streaming headers display the thread name, such as **Alpha plan · Working**, and update from the canonical thread title. The collapsible thread/status header uses Obsidian's default bold styling while retaining its heading size, timer, activity animation, and fold controls. The thread-name header disappears when the reply completes. Titles are escaped as plain text. Before the thread is available, the prepared send title labels its block. Multi-response controls show the name and short block ID.


For an explicitly requested version, use `npm run release:qlo2 -- --version 2.28.1`. The same clean-worktree, strictly newer version, immutable archive and live-smoke requirements apply as for `--bump`.

Agent-triggered `send-note` and `attach-note` commands require an existing folder link when a note would otherwise create a new folder project. Use `link-folder` first; these commands cannot open the interactive workspace picker.

### Direct event actions

`subscribe` and `subscribe-job` accept `--action` JSON in place of receiving
`--thread-id`, `--project-id`, and `--environment-id`. Direct actions execute
on the designated vault connection machine while its Obsidian client is open;
they create no T3 message or agent turn. Existing thread subscriptions keep
working as before.

To move each note whose `status` becomes the string `ready`:

```sh
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  subscribe --scope 'Jobs/Priority/Draft' --scope-kind folder \
  --event property --property status --equals '"ready"' \
  --action '{"kind":"move-note","folder":"Jobs/Priority/Ready"}'
```

To set a property when a note is created:

```sh
python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 \
  subscribe --scope 'Jobs/Priority/Draft' --scope-kind folder --event create \
  --action '{"kind":"set-property","property":"status","value":"draft"}'
```

Supported actions are `move-note` (`folder`) and `set-property` (`property`
and a JSON `value`). They act on the observed note unless `notePath` names an
explicit vault-relative Markdown note. Move preserves the filename, creates
missing destination folders, and refuses existing destinations. Set-property
preserves the body and rewrites frontmatter using Obsidian's YAML formatter;
frontmatter comments/formatting may change. Hidden paths and plugin logs are
excluded. A delete event needs an explicit `notePath`, since the observed note
no longer exists.

For `subscribe-job`, keep the exact worker job arguments documented below,
replace the receiving thread arguments with `--action`, and include `notePath`
in that action. Job actions default to `completed`; repeat `--job-state` to
select other lifecycle transitions. Completion remains an execution signal,
not proof of product delivery.

Actions are immutable per subscription. Scope/filter updates, pause, resume,
and cancel use the existing management commands. `subscriptions` includes
pending errors and bounded completed/skipped action receipts (`delivered` or
`cancelled`). Pause/cancel stops queued work but cannot undo an applied action.

The host persists exact action inputs and outputs before writing, verifies
results, and recognizes the same output on retry. It refuses conflicting note
changes and unsaved editor text rather than overwriting them. Fix a conflict
or cancel and register a new subscription. A property trigger that has reverted
before preparation is skipped. Matching action-generated editor events are
suppressed across subscriptions for a bounded window; later user edits still
trigger. Actions do not automatically chain through other subscriptions.
Unresolved plans retain note text privately; terminal action receipts retain
only paths, action metadata and hashes.

### Job lifecycle notifications and thread display registrations (2.30)

These registrations are independent of sends, folder links, Previous thread,
and response bindings. They are hosted by the existing vault connection machine
and use its private event store and authenticated command mailbox.

`subscribe-job` observes one exact execution request. Supply the receiving
orchestrator's `--thread-id`, `--project-id`, and `--environment-id`, plus
`--job-id`, `--job-request-id`, `--message-id` (original user message),
`--job-thread-id`, `--job-project-id`, and `--job-environment-id`. Optionally
supply a verified `--turn-id`; it is never a dispatch command ID. Register
immediately after the send acknowledgement; fast completed replies are caught
up from canonical history. Provider start failures correlate by the exact
original message even before a turn ID exists. Several jobs may use the same thread.

Notifications identify the job, original request/message, actual turn when
known, project, environment, blocking request and stable event ID. Approval
and input waits are recoverable; resolution emits `running`. `completed`,
`failed`, `interrupted`, and explicit `cancelled` turn states are terminal for
that execution. A T3 Stop normally appears as `interrupted`. A new execution
needs a new job watch. A transport outage leaves observation retryable;
attachment errors do not change execution outcome. Completion is explicitly
**unverified product delivery**: the orchestrator must verify the matching
immutable release and live-smoke receipts before settling a release job.
Use existing `subscriptions`, `pause-subscription`, `resume-subscription`, and
`cancel-subscription` management commands. Job resume catches up unseen states
of the same execution; note/folder resume still establishes a silent baseline.
Cancelling a watch cancels unsent notifications, never T3 execution.

`stream-thread --stream-scope thread --thread-id ID --project-id ID
--environment-id ID --destination A.md --destination B.md` explicitly registers
all later logical responses from that source thread, including runs started
in T3 and event notifications. It sends no prompt and changes no routing.
The default `--start future` boundary excludes every user message already in
the complete canonical history at registration; `--start history` also catches
up existing responses. Each eligible response/destination has a durable child
binding ID. Missed runs catch up after reconnect/restart; completed bindings
remain receipts after marker cleanup. Same-turn steering and already attached
continuation/question-answer lineage stay in their original blocks. Existing
send-created bindings in a destination are reconciled instead of duplicated.
One thread can feed several notes and several threads can feed separate blocks
of one note, through the local reply bindings and placement rules.

Inspect with `thread-streams`; manage with `pause-thread-stream`,
`resume-thread-stream`, `cancel-thread-stream`, or `remove-stream-destination
--remove-destination A.md`, each with `--subscription-id ID`. Pause and cancel
stop future attachment; independently registered active child bindings finish
normally. Resume starts a new future boundary, skipping runs created while
paused. Removing a destination stops future attachment only to that note.
These commands never interrupt a turn. Use the response's Stop control when
interruption is intended. Destination paths follow Obsidian note/folder rename
and Sync events; stable destination IDs survive the rename. Missing or
unwritable notes remain inspectable attachment errors, preserving surrounding
content and allowing retries. A deletion alone never redirects output to an
unrelated note. Existing `send-note` and `attach-response` remain response-only.

Use a fresh retained request UUID for each command and replay identical input
after timeouts. Successful results are immutable snapshots; use a fresh UUID
for a current listing. Lifecycle identities, event replay cursors, pending
notification bytes and planned child bindings persist before external writes.
Bounded live verification must include an idle orchestrator receiving a worker
outcome, its resumed reply streaming automatically, and independent verification
of the actual outcome rather than interpreting a transport acknowledgement.

### Intermediate responses and elapsed time

**Intermediate agent responses** has one style: a collapsible progress box. Settings and per-send overrides explain the automatic behavior instead of offering Remove / Keep / Collapse choices. New responses always use this style, including devices with older preferences. Previously saved response requests retain their original presentation policy for safe recovery.

Each response keeps its chronological history in one native `t3-progress` callout. The box opens by default at submission and stays open while work or final text streams. It closes only when the final answer is complete. Errors, interruptions and reconnects leave progress open by default. Intermediate prose, steering messages, question answers and earlier completed turns share its top thread/status header, elapsed timer and collapse control. There are no additional **Progress** headings or independent folds around inputs. The current completed turn's final answer stays visible below the history; Raw Markdown applies to that final answer, while earlier answers inside collapsed history use the history formatting. Independent responses keep their own headers and fold choices. Titles use H6 typography and heading semantics. Explicit blockquote boundaries contain nested headings, tables, code and neutral sender quotes without folding the latest final answer, pending questions, actions or subsequent note content. Editor Live Preview and Reading view share Obsidian’s native fold behavior. Active history retains its rendered text and tool details while direct display updates are grouped at 80 ms intervals. Clicking history text in Live Preview keeps the rendered view; links, tool summaries and text selection remain available. Its native edit button is replaced by **Follow response** while the response runs, then by the close button after completion has reached the saved note. It removes the history callout and keeps the final answer and surrounding note text. Clicking or keyboard-toggling a header preserves that choice in the current client. Completion resets the live fold choice to closed; manually reopening the completed box remains supported. Source mode exposes the same native Markdown presentation; generated active text is protected, while ordinary note text remains editable.
Tool activity follows T3's timeline rules. One current dropdown uses a compact label such as **Running npm**. Earlier consecutive calls appear in closed dropdowns with action summaries such as **Ran 4 commands and changed 7 files**. Summaries count commands and distinct changed files, combine actions in their first-seen order, and keep failures visible. Prose, reasoning, user input and turn boundaries separate batches. Expand a batch to inspect each tool's working directory, exact command, output, duration and exit code when T3 supplies them. Command and output blocks support Copy. Updates merge by the exact turn and tool ID, retain concurrent calls, and keep completed results in history. Output is escaped and limited to 20,000 characters per row for display.

Consecutive public thought summaries share a closed **Thought** row with a brain icon, a count such as **Thought (×2)**, and the first summary's time in the current client's time zone. Open the row to read the summaries with their Markdown formatting. Prose, tools, user input, plans and run boundaries start a new group. Each pane keeps its own open or closed choice while summaries stream. These are the public summaries supplied by T3; they do not change run completion or final-answer handling.


Displayed input quotes omit the generated trailing three-line **Sent from Obsidian. / Vault: / Note:** footer. Older vault/destination footers and their associated reply-delivery instruction remain supported for recovered history. The same rendering applies to recovered transcripts and retains **You**, **User** and **Agent · source title** attribution. Canonical T3 messages, delivery identities, checkpoints and selection receipts retain their original bytes; this is an Obsidian display change, not a hidden system-message channel. Ordinary prose, malformed metadata and quoted or fenced examples remain visible. Completed Markdown from older releases is unchanged until its response is rendered again.

The elapsed counter sits beside the animated working status. It measures wall time from submission through completion, including waiting and reconnects. Saved timestamps let each client update its DOM once per second without rewriting the note or triggering Sync. Completion freezes and retains the final duration. Stop retains a frozen Interrupted header with the progress box open by default. Late question answers resume the counter for the continued response.

The current activity dropdown sits at the bottom inside the progress box and uses the same text size as earlier tool dropdowns. When no tool label is active, the bottom row shows **Thinking** with a brain icon; the top status still shows **Working**. Like T3, its latest successful call keeps a present-tense label until another timeline entry or the end of the turn replaces it; the expanded result already shows its actual completed status. Failed, declined and stopped calls keep their outcomes. Final answers and question controls remain visible. Each response and destination follows its own bound turn. Completion removes the live row and retains its calls in history. Stop removes the live animation and preserves the displayed results.

### Selected requests

Send to agent submits only the unsent part of the captured selection. Ask agent
opens the composer and sends your question with the unsent selected source.
Neither action expands the selection or opens a preceding-context review.
The command bar keeps its direct typed-question behavior and uses the same
source tracking. Embedded images use the normal attachment pipeline.

### Native coordinated responses

With an updated vault host, streaming Markdown is displayed in Obsidian's native view and excluded from saves. The host journals checkpoints. For newly negotiated responses, the sending device takes a permanent final-write grant, journals and publishes its save intent, and saves the finished response once. Other devices receive it through Sync. The host can finish only if the sender becomes unavailable before the grant. Older registrations keep host completion. Generated note edits can join the same checked save through `stage-note-edit` and `submit-note-edit`; privileged direct filesystem writes bypass this protocol. The existing formatter, per-destination identities, progress settings and controls remain in use. Older hosts retain the previous writer until they advertise support.

The final response stays visible while the saved note travels through Sync. Each pane replaces its local display only when it can adopt the verified saved result and preserve ordinary edits. Host completion alone never clears the block. Immutable commit evidence also recognizes intact results in later note versions containing outside edits or another completed response; uncertain or conflicting updates preserve the local display for review.

After the final save and cleanup, completed replies retain only small routing, message/turn identity and delivery indexes in host memory. Full prompts, reply bodies and verified recovery documents are loaded from private storage only for recovery or historical checks. Raw leases, commit documents, originals, staged results and frozen reply bodies are not kept in the byte cache. Native panes retain their reply and commit proof until the saved reply is adopted; pending saves, questions, migrations and conflicts keep their working data. Compaction changes memory retention only: durable lease and journal bytes remain available, and commands recheck them before any mutation. `client-status` reports completed index counts and native proof retention.

When a native response view detects competing ordinary text, it automatically adopts a fresh, rechecked saved note and discards the conflicting local text. It creates no local recovery copy and opens no conflict dialog. Normal typing and compatible unsaved edits continue through native saving. Missing or resurrected response anchors still wait for verified completion evidence so stale Sync data cannot erase a completed reply. The removed manual-choice command is no longer registered. Existing device-local editor conflict copies and choice receipts are deleted on load; final-delivery journals and completed-response proofs retain their separate lifecycle.

Note sends, attachments and thread display registrations accept `--destination-section 'Exact unique heading'` for native placement inside a note section. Do not relocate live response blocks by raw filesystem edits while their editors are open. Divergent native buffers are retried or preserved as conflicts. `resume-response --binding-id UUID` resumes a paused binding after its exact boundaries are restored and saved. For an active native response, `repair-response --binding-id UUID --hash REVIEWED_CURRENT_HASH` restores a proven missing anchor or preserves text from inside intact boundaries outside the repaired anchor, with checked saves and private before/after evidence; `response-status` and `repair-response --hash REVIEWED_CURRENT_HASH` expose and safely repair journaled conflicts. For duplicate recovery, read `response-status --binding-id UUID`, review its `locations` and `locationHash`, then run `resolve-response-location --binding-id UUID --note-path 'Chosen/Note.md' --hash LOCATION_HASH`. Changed candidate notes require a fresh review. Canceled bindings cannot be resumed through this command. See [the delivery architecture and command protocol](docs/coordinated-response-delivery.md).


## Agent skill and clean prompts

The maintained [Obsidian agent skill](docs/obsidian-t3-SKILL.md) has the trigger
**Trigger when user sends from Obsidian.** It contains plugin operating guidance,
including checked note staging, reply placement, routing, subscriptions, and
maintenance. Run `python3 scripts/install-obsidian-skill.py` to link local agent
skill installations to this source; `--check` verifies those links. Existing
regular-file copies are backed up outside the vault before replacement.

New prompts end with only:

```text
Sent from Obsidian.
Vault: QLO2
Note: Projects/Task.md
```

`note-context 'Projects/Task.md' --thread-id ID --message-id USER_MESSAGE_ID
--environment-id ID` is a read-only command through the existing desktop endpoint.
It returns exact send data and reply bindings, without a prompt or credentials.
Use a fresh command UUID for current inspection. Records contain only identity,
source path, binding IDs, creation time and the wait preference; they merge
through normal settings Sync and retain the latest 256 sends. Several matches
require exact filters; no newest-send guess is made. Subscription notifications
also use the clean footer and retain observed event data as their message body.
