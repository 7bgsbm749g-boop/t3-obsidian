# Send to T3 Code — 2.7.0

One Obsidian plugin for desktop and mobile. Right-click a Markdown note in **Files → Open in T3 Code → New thread in <project>**. The note is sent verbatim, with embedded images attached at their original positions. No vault/path/title wrapper is added; the note title names the thread, without an “Obsidian:” prefix.

**No Fleet adapter is required. No persistent delivery queue exists.** The plugin includes local and portable direct T3 clients. There is no companion service or SSH/Python forwarding. Sends require the selected machine to be online and running T3. After a confirmed start, the T3 turn continues independently of Obsidian.

## Setup: desktop and mobile

1. Install and run T3 Code on your computers. Sign in to the same T3 account and enable **T3 Connect** on each destination. T3 supplies the public HTTPS connection; no Tailscale or plugin companion is required. See [T3 remote access](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md).
2. Install `main.js` and `manifest.json` in `<vault>/.obsidian/plugins/send-to-t3-code/` and enable the plugin.
3. In **Settings → Send to T3 Code**, keep **T3 Connect (recommended)** selected. Enter your T3 account email and click **Send sign-in code**.
4. Enter the six-digit code from T3’s email and click **Verify and connect**. The plugin discovers your account’s computers, authorizes each online connection and scans its projects automatically. No terminal commands, machine URLs, pairing links or per-machine codes are needed.
5. Enable the projects you want in the note menu. Their names include the destination computer. On mobile, use the note menu → **Open in T3 Code**, or the **Send current note** command.

Sign in once on each device. Project choices, connection names, and folder links sync, but account credentials do not. Until this device is signed in and its machine/project discovery completes, the settings page shows only the sign-in or connection-progress screen. Projects, computers, orchestration, folder links, manual pairing, and saved-request controls remain hidden so synced names cannot be mistaken for a live connection. **Refresh connections** retries discovery and authorization. The plugin refreshes connections after reopening Obsidian and renews account-managed sessions before they expire when used. This never resends notes or queues work.

This is an independent integration with T3’s existing native authentication and relay APIs. Email verification uses T3’s Clerk native frontend API, enabled by T3, and its `t3-relay` token template. The relay accepts that credential and issues device-bound connection grants. The plugin requests only environment thread read/operate scopes. It does not read installed T3 credentials or browser cookies, impersonate an existing device session, register a replacement `t3code://` handler, or need access to your email inbox. It does not collect your T3 password or create a new T3 account.

Account/session tokens stay in device-local, vault-specific Obsidian storage and are not OS-keychain encrypted. The device’s non-extractable DPoP signing key stays in local IndexedDB. Neither is written to the synced vault. Email verification codes are not retained. **Sign out** removes account credentials and account-managed environment sessions on this device, and asks T3 to revoke this sign-in session. Independently paired manual connections are retained. If revocation cannot reach T3, the plugin reports that local sign-out succeeded and directs you to T3’s account controls for remote revocation. A cancelled or expired sign-in does not restore account access later.

Sources: [T3 relay authorization](https://github.com/pingdotgg/t3code/blob/main/infra/relay/src/http/Api.ts), [T3 managed account authentication](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/cloud/managedAuth.tsx), [Clerk email-code sign-in](https://clerk.com/docs/guides/development/custom-flows/authentication/email-sms-otp), and [Clerk native API behavior](https://clerk.com/docs/guides/development/errors/frontend-api).

### Advanced: manual pairing

After account connection finishes, existing manual pairings still work. Expand **Advanced: manual pairing** to use a known HTTPS environment address and a fresh T3 pairing code or link. A hosted `https://app.t3.codes/pair?host=…#token=…` link is accepted. Each device pairs separately; manual sessions require pairing again after their displayed expiry. Re-pairing preserves selections and pending requests.

T3’s Connections page currently hides its pairing controls when Network access and Tailscale HTTPS are both off, even when T3 Connect is enabled. In that case the official `t3 auth pairing create --ttl 10m --label Obsidian --json` command on the destination can issue a code without changing its network settings. This command is **not needed for the recommended account setup**.

Manual pairing exchanges a one-time code for a scoped bearer session. The code is discarded, and the session remains only on this device. **Forget pairing** removes the local credential; revoke its client session in T3 Settings → Connections to revoke server access. Remote connections require HTTPS and refuse redirects; HTTP is allowed only for loopback testing.

### Advanced: this computer only

Desktop users can choose **This computer only (advanced)** to use local T3 without account sign-in. Install T3 and its matching official CLI. The plugin discovers the CLI in standard locations or PATH; executable and data-directory overrides are available if needed. Scan projects and select the ones you want. The CLI issues five-minute sessions for T3’s authenticated loopback API, which the plugin revokes after each operation. No shell interpolation, Python or Fleet adapter is used. This option is unavailable on mobile.

The destination must remain online. There is no offline queue or automatic resend. An interrupted send is saved for **manual Retry** with its exact original commands, preventing duplicate threads after a lost response. Completion monitoring uses the same connection while Obsidian is active.

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

Install 2.7.0 and reload the plugin on each device after Sync finishes. Existing manual connections and project selections remain intact. Each device clearly requires its own email verification before synced projects and folder links become visible. The old HTTPS companion mode and bundled Python/SSH code are removed. Devices previously using that mode now open **T3 Connect** and can use the account setup above. Old service URLs, keys and remote project catalogs are removed from the active settings. Local desktop settings and direct connections remain available.

Old unconfirmed sends remain visible for review but cannot be retried through the removed mode. Check the original thread in T3 before creating another send, since the earlier request may have started. Discard only removes the local retry record. Old companion completion jobs keep their notes and stop monitoring. Direct/local completion monitoring continues. No request is automatically rerouted or sent during migration.

The obsolete companion service is no longer part of the plugin. Its operator can stop/remove it after upgrading their clients. Historical state backups may be retained privately, but neither companion nor queue files are read by this plugin.

## Command palette chat

Open Obsidian’s command palette (Ctrl/⌘ + P, or your configured mobile swipe-down action) and type a message. **T3 Chat: “your message”** stays at the top of the results alongside normal commands. Select it with Enter or a tap to create a new T3 thread. The full typed text is sent, with its first line used as the title; the open note is not included.

With one selected project it sends there. With several, choose the destination on your first chat; the plugin remembers that choice. Change it in **Settings → Send to T3 Code → Chat → Chat project**, or select **Choose on next chat**. You must sign in on this device and finish project discovery first.

The regular **Send to T3 Code: New T3 chat** command opens a message editor with a project chooser and Send button. It also works as a hotkey/mobile toolbar action, and is the fallback when Obsidian’s live palette integration is unavailable. The live row uses isolated, version-checked internal command-palette methods because Obsidian does not expose a public dynamic-result API. It restores those methods when the plugin is disabled. Keep the core Command palette plugin enabled; future Obsidian changes may require an update.

Chat messages use the same connection, size limit, optional wait instruction and manual-retry handling as note sends. They do not attach the current note or enroll any note for completion cleanup. If delivery is unconfirmed, use **Unconfirmed requests → Retry** to reuse the original request rather than starting another thread.

## Orchestration

Settings → Send to T3 Code → **Orchestration → Wait for other threads** is off by default. Enable it to prepend this instruction to each new note or chat prompt:

> Before starting work on the task below, wait for all other active T3 Code threads in this project to finish. Exclude this thread and threads in other projects. Check their status periodically, and begin work only when no other threads in this project are active. If you cannot check thread status, ask the user before proceeding.

The setting persists per vault. This is an instruction to the receiving agent; the plugin does not enforce a project lock or wait before delivery. There is no delivery queue. It requires the agent to be able to check T3 thread status. The remaining note content and image references are unchanged. Retries use the originally saved prompt, even if this setting changes afterward.

## Folder links

Right-click a folder and choose **Link to T3 Code → Link to <project>** to save an association between the Obsidian folder and a T3 project. Links appear under **Settings → Send to T3 Code → Orchestration → Linked folders**. Links are inactive by default: saving a link alone does not send notes.

On desktop, **Link to self** registers the folder as a project in the local T3 Code installation using the official `t3 project add` command, then saves the resolved project ID and workspace root. Arguments are passed directly to the executable without a shell. If T3 already has a project for that path, the existing project is reused. Mobile can save links to discovered projects, but cannot register its private mobile filesystem as a project on another computer.

Folder links sync with the vault. T3 credentials remain device-local. Legacy workflow/tag settings migrate to inactive links; upgrading never enables automatic sends.

### Optional tag sends

Under **Orchestration → Linked folders**, enter a tag (for example `#ready`) and enable **Automatic send on tag** for that link. With the setting off, the link remains a saved association only. The enabled rule applies to new, edited or moved Markdown notes in that folder and its subfolders, including changes arriving through Obsidian Sync. It uses Obsidian’s parsed inline/frontmatter tags, with exact, case-insensitive matching; text in code blocks does not count. A more specific nested folder link owns its subtree, even if its trigger is off.

Renaming linked folders preserves their saved links, including nested links. A renamed self-linked folder pauses its trigger until you relink it to self, because its T3 workspace path must be refreshed.

Enabling a rule does not scan or send existing notes. Edit or move a matching note afterward to trigger it. A successful send uses the same full Markdown/image handling and completion settings as a manual note send. Subsequent edits or renames of that note do not create another thread for the same link on the sending device.

The device that enables a rule runs it while Obsidian is open. Its ownership is saved with the link and synced; another device shows **Run on this device** to transfer it. Delivery receipts stay device-local. Changing the owner or relinking a folder can make previously sent notes eligible on a later edit; this is not distributed exactly-once delivery. No background delivery service or persistent queue is created.

Failed or interrupted automatic sends require review in settings. If there is an **Unconfirmed request**, retry with its saved request ID. After checking T3 and discarding an unwanted retry record, **Allow on next edit** permits another attempt. Startup, reconnection and repeated note events never automatically retry a saved failure.

## When task completes

Under **Orchestration → When task completes**, choose **Keep note** (default), **Archive note**, or **Delete note (vault trash)**. Archive has a configurable vault-relative folder, defaulting to `Archive/T3 Code`; it preserves the note’s original subfolders and adds a numeric suffix if a destination already exists. Delete moves only the Markdown note to this vault’s `.trash`; embedded image files remain in place.

The plugin polls the destination T3 environment every 30 seconds while Obsidian is active. Mobile can suspend the app; checks resume when reopened. The completion signal is the original sent turn reporting `completed`, with its session idle (ready or stopped), no pending approval/input, and its original user message and final assistant message verified. This is a T3 lifecycle signal, not a judgment that the answer fully solved the task. Failed/interrupted turns and conversations that have advanced to additional turns keep the note.

The completion action and note fingerprint are saved when sending. Later setting changes affect new sends only; retries preserve the original action. Monitoring resumes after Obsidian restarts and retries connection errors. **Task completion monitoring** shows status and offers **Check now**, **Stop monitoring**, and **Dismiss**. Starting a newer send for the same note supersedes its previous cleanup action once that send is confirmed.

Notes edited, replaced, renamed, or left with unsaved editor changes are kept. Archive/delete runs in the sending Obsidian vault, including when the T3 thread runs on the VPS. Existing notes and previously sent threads are not automatically enrolled.

## Embedded images

Supported embeds: `![[image.png]]`, `![[folder/image.png|300]]`, `![alt](relative/image.png)`, reference-style Markdown images, HTTPS image URLs, and base64 image data URLs. Local links use Obsidian’s resolver relative to the source note, including attachment folders and percent-encoded paths. Images inside code blocks, inline code, frontmatter, and escaped wiki embeds are ignored.

PNG, JPEG, GIF, and WebP bytes are uploaded through T3’s native attachment API. Each original embed is replaced by a native `t3-context://` reference, so the image stays at that point in the message. Repeated images reuse one attachment; all other Markdown is unchanged. Neither the note nor its images are moved or modified in the vault. HTTPS downloads use Obsidian’s `requestUrl` with no access key or authorization headers added. Mobile downloads are buffered by Obsidian before the byte limit can be checked; for large remote images, download a resized copy into the vault first.

Limits: 8 distinct images, 10 MiB per image, 20 MiB combined, and T3’s 120,000-character prompt limit. Missing images, failed downloads, HTML `<img>` embeds, unsupported formats such as SVG/HEIC, and limit violations stop the send with an error instead of silently omitting images. Convert unsupported formats to PNG/JPEG first. Non-image wiki transclusions (notes/PDF/audio) remain as Markdown and are not expanded. Image-only notes work.

The plugin includes image support. The selected T3 model/provider must accept image input. Direct pairing is verified against T3 0.0.43-nightly.20260917.1866; local integration was also tested against 0.0.43-nightly.20260916.1811; recheck compatibility after T3 upgrades.

## Empty states and recovery

Empty notes are rejected without creating a thread. No selected projects shows a clear disabled menu item and a project selector. Failed scans report the error and preserve the last discovered list; unavailable selections are retained for later rediscovery. Sending to a removed project reports an error without scheduling delivery.

A request is saved before dispatch. During sending, additional sends are disabled. If a response is lost or fails, **Unconfirmed requests** in settings offers **Retry** using the exact original content, connection, and request ID. Do this instead of clicking New thread again, which intentionally creates a separate request. **Discard** removes only saved local retry data; it does not cancel or delete any T3 thread. Restarting Obsidian does not resend anything automatically.

Pending requests store the full note and base64 image bytes in local IndexedDB until confirmed/discarded. Direct mode stores the complete immutable commands in device-local IndexedDB before dispatch, without a server-side plugin journal. Local desktop integration keeps a private request journal under the T3 data directory (`send-to-t3-code/desktop`). Journals retain prompt/image bytes to retry exactly; they contain no session credentials. In local mode, T3 credentials are issued through its official CLI and revoked after use. Direct pairing sessions stay in device-local app storage. Official CLI output is bounded and each CLI operation times out after 45 seconds. Note contents and image payloads travel in authenticated HTTP request bodies, never shell commands or CLI arguments.

## Development

Requires Node.js and npm. Run `npm ci`, `npm run build`, and `npm test`. Build output is `main.js`. The plugin registers Obsidian's vault/metadata events for optional tags and the `file-menu` event and uses the runtime `MenuItem.setSubmenu()` extension, with a project picker fallback if unavailable; mobile uses the picker. See [Obsidian plugin setup](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin).

Git tracks the TypeScript source, tests and dependency lockfile. The generated `main.js`, packaged releases, local validation artifacts and Python caches are ignored. Building creates the `main.js` required for installation; ignoring it does not remove an installed copy.

This is a local community-plugin-format build; it has not been submitted to or approved for the public community directory.

The browser-targeted bundle includes portable hashing and binary utilities. Desktop Node imports live in `desktop.ts`, loaded only after a platform guard. Tests evaluate the built bundle without `process`, global `Buffer`, or access to Node modules, then send an image note through mocked Obsidian APIs. This is a compatibility test, not a substitute for testing on an actual iPhone/Android device.

Release 2.3 passes 32 automated tests covering native email verification, wrong-code/expiry errors, credential rotation, device-bound proof verification, automatic multi-machine connection, partial offline recovery, renewal coalescing, sign-out and cancelled verification. The built mobile bundle is tested without Node APIs. Live desktop validation records are kept locally in the ignored `evidence/` directory; actual iPhone/Android verification remains separate.

Live 2.3 validation in QLO2: one email verification connected both laptop and VPS, plugin reload preserved sign-in, and Files-pane right-click sends to both hosts completed with two correctly recognized images. Original user settings were restored and test notes removed.

Live 2.7 desktop validation: the real command-palette row submitted the exact typed prompt and received a completed T3 response. A linked folder sent nothing with its trigger disabled, sent one tagged note after enabling, and created no duplicates after repeated edits and a rename. Build and all 66 automated tests passed, including mobile-compatible bundle delivery, palette lifecycle, event parsing, folder renames and retry durability. Test notes were removed and original development-vault settings restored.
