---
name: obsidian-t3
description: "Use the Send to T3 Code Obsidian plugin to start or continue T3 threads from notes and attach replies to streaming destinations. Use for authenticated folder routing commands, agent-triggered Obsidian note sends, mirroring replies into several notes, streaming several threads into one note, and managing subscriptions that notify their originating T3 thread when a note/folder changes. Use personal-fleet for machine-to-machine T3 dispatch."
---

# Obsidian T3 Plugin

Use the running Obsidian plugin's command interface for note-driven T3 work. Loading this skill alone does not authorize a send. Honor the user's requested notes, destinations, and thread behavior.

## Prerequisites

- The CLI is `/home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py`.
- The usual local vault is `/home/ubuntu/vaults/QLO2`; honor another requested vault.
- That vault must be open in a real Obsidian desktop client with Send to T3 Code 2.29.1 or newer for folder commands (2.28.1 for subscriptions; 2.17.0 for note sends) enabled. Its authenticated T3 connection and streaming coordinator must be reachable.
- This is a local filesystem command bridge, not an MCP tool. Run it on the machine where that desktop vault is open.
- Source and destination notes must already exist. Pass vault-relative `.md` paths. Absolute paths, traversal, hidden paths, backslashes, and control characters are rejected. At most 32 unique streaming destinations are supported.
- `--config-dir` defaults to `.obsidian`; specify it for a vault using a different configuration directory.

The plugin reads the source note and embedded images, resolves its normal project routing, registers reply destinations, then dispatches the prompt once. Routing can create a project for an unlinked folder; inspect the intended routing first when project choice matters. Do not substitute direct T3 dispatch or hand-written streaming records for this flow.

The source note supplies the prompt. Create or edit it when authorized; do not overwrite an existing note merely to inject different instructions.

## Inspect and change folder routing

Folder commands require an existing vault-relative folder; `/` means the vault root. Use the requested vault and configuration directory. Never edit installed `data.json`. Each command needs its own retained UUID; replay exact arguments after a timeout and use `--retry` after fixing a failure. A repeated inspection returns its original snapshot, so use a new UUID to inspect current state.

```bash
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py \
  --vault /home/ubuntu/vaults/QLO2 --request-id INSPECTION_REQUEST_UUID \
  inspect-folder 'Projects/Side/handoff'

python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py \
  --vault /home/ubuntu/vaults/QLO2 --request-id LINK_REQUEST_UUID \
  link-folder 'Projects/Side/handoff' \
  --project-id PROJECT_ID --connection-id CONNECTION_ID --environment-id ENVIRONMENT_ID

python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py \
  --vault /home/ubuntu/vaults/QLO2 --request-id UNLINK_REQUEST_UUID \
  unlink-folder 'Projects/Side/handoff'
```

Replace placeholder UUIDs and identities with verified values. `--connection-id` is an exact paired connection ID from this device's configured connections, or `local` for its desktop T3 server. `--environment-id` must identify that connection's real machine. Select the existing project by its ID from authenticated project discovery; for the handoff workflow verify its workspace is `/home/ubuntu/projects/agentic-handoff`. Do not select by title alone or infer an environment from a directory name. The plugin rechecks the authenticated environment and live project catalog and obtains title/workspace itself. An unavailable destination leaves the old link intact.

Default `--mode project` links to an existing repository. `--mode self` requires an existing project rooted at that exact vault folder. For a paired connection, that machine must already be the verified vault project machine and the folder must have reached it through Sync. The vault root only supports self mode. Folder commands never create projects, dispatch prompts, or start threads; create a missing self project separately through the normal user flow.

A different direct link requires `--relink`. Add it deliberately with a new request UUID after inspecting the old link; do not change arguments under the old UUID. Unlink removes only that folder's direct link. Child links, remembered note/thread bindings, source files, and existing conversations remain intact. New sends use the updated routing; existing conversations stay in their original project.

Results include `vaultId`, `folderPath`, `directLink`, `effectiveLink`, and `routing`, with no connection credentials. `effectiveLink` is the nearest saved ancestor, including the vault root. `routing: new-folder-project` means a new send from this otherwise unlinked folder would create its own project despite a root link; establish a non-root link before sending to a repository. `vault-project-setup` means the root is unconfigured. Inspection reads saved routing without requiring the destination to be online. Link metadata and successful inspection acknowledgements are snapshots, not ongoing availability guarantees.

Folder edits and unlink tombstones are recorded per folder in synced settings and retained locally to repair stale whole-file replacements. Reload the updated plugin on other devices before editing folder links there; newer explicit edits take precedence.

For verification, link a uniquely named temporary folder to a verified existing project, inspect it using a new UUID, replay the link UUID, deliberately relink, unlink, and clean up. Confirm its Files explorer T3 indicator changes. A bounded note send from the linked folder should appear in the selected T3 project; record its returned IDs and verify its completed reply before deleting the temporary note. Preserve the user's current folder links and note.

The command flow was verified on the real QLO2 VPS client with version 2.29.1 using a temporary folder and a completed bounded note send. Validation covered both self modes, inheritance, nested precedence, relinking, unlinking, safe retries and the folder indicator. The durable [smoke receipt](/home/ubuntu/backups/send-to-t3-code/releases/2.29.1/smoke-vps-qlo2.json) records the evidence; the temporary folder has been removed.

## Start or continue a thread from a note

Generate one request UUID and retain it with the exact arguments before dispatch. Substitute the user's existing note paths:

```bash
note_request_id=$(python3 -c 'import uuid; print(uuid.uuid4())')
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py \
  --vault /home/ubuntu/vaults/QLO2 \
  --request-id "$note_request_id" \
  send-note 'Projects/Task.md' \
  --destination 'Projects/Task.md' \
  --destination 'Projects/Summary.md'
```

- A new T3 thread is created by default.
- `--thread-id THREAD_ID` sends only added note text into that existing thread through Smart Send; it can steer active work. Deleted text and generated replies are excluded. A send with no new source sends no prompt.
- Without `--destination`, the reply streams into the source note.
- Explicit destinations replace that default. Include the source explicitly if it should also receive the reply.
- `--no-stream` sends without editor streaming; do not combine it with streaming destinations.
- Several threads can stream into one note: issue separate sends with different request UUIDs and the same destination. Wait for each command's acknowledgement before issuing the next; their response streams can then run concurrently.

Save the returned JSON: `id`, `ok`, `threadId`, `messageId`, and `bindingIds`. Each binding identifies one destination block. `messageId` identifies the original user message, not an assistant message, turn, or command request. A successful acknowledgement confirms dispatch and registration, not response completion.

## Attach an existing response to more destinations

Use a new command UUID and the original send's `threadId` and user `messageId`:

```bash
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py \
  --vault /home/ubuntu/vaults/QLO2 \
  --request-id ATTACHMENT_REQUEST_UUID \
  attach-response 'Projects/Task.md' \
  --thread-id THREAD_ID \
  --message-id USER_MESSAGE_ID \
  --destination 'Projects/Another note.md'
```

Replace all placeholder IDs. The source note's linked project must contain that thread and message. Repeat `--destination` to attach several notes. Attaching sends no new prompt; it catches up with the response and follows it until completion. Completed responses can also be attached from history. A binding follows one response, not all future responses in a thread.

If IDs were not retained, inspect the original command result or existing binding records. An active note block has `<!-- t3-inline:start:BINDING_ID -->` and matching end markers. The coordinator lease record at `<storageRoot>/<configDir>/t3-code/inline/v1/leases/<bindingId>.json` contains `request.threadId`, `request.messageId`, and `request.notePath`. Read these records only. If several sources remain plausible, clarify the intended response.

## Retry safely and verify completion

Read `<vault>/<configDir>/t3-code/storage-route.json` for the checked private `storageRoot`; use the vault root only for hosts without a route. Command requests and results live under `<storageRoot>/<configDir>/t3-code/commands/v1/{requests,results}/<requestId>.json`. Treat them as plugin-managed records.

- Timeout exits with code 2 and `pending: true`. Reissue the exact command with the same UUID and arguments. Do not create a replacement UUID: the original send might already have succeeded. `--timeout` defaults to 90 seconds and can be adjusted.
- Failure exits with code 1. Inspect the error, fix its cause, then use `--retry` with the same UUID and arguments. Prepared sends retain their prompt, attachments, timestamps, and T3 identities for safe recovery.
- Reusing a UUID with changed arguments is rejected. Do not alter existing request files to bypass this.
- If unchanged prerequisite or provider errors recur, stop repeating dispatch and report the error and request ID. If the command bridge is unavailable, report the running-client or version requirement; do not install a replacement plugin without a request for that change.

Inspect every destination's actual content. For a completion claim, verify each binding's durable `state.status` is `complete`, alongside its final note block. `paused`, `conflict`, `interrupted`, or `error` is not successful completion. An acknowledgement alone is insufficient.

Preserve tracking comments while a response is active. The agent owns an active block's contents until completion: edits and Sync changes inside intact markers are overwritten by the latest T3 output. Edits outside blocks are preserved. Removing or damaging a marker stops insertion into that destination. Each block's status header shows its source thread name.

## User controls and combined flows

Ask within an active response block targets that response. Ask outside active blocks creates an independent reply. The editor menu's **Ask T3 in this response** explicitly selects the target. Stop and Continue controls are scoped to response blocks; choices identify threads by name and short ID.

Stopping a T3 turn interrupts every destination following that turn. Removing one destination block stops insertion into that block while other destinations and the T3 work continue.

For a combined flow, send note A to destinations X and Y, then send note B to those same destinations using a different UUID. The two threads each have independent blocks in X and Y. Either thread can invoke this CLI to create further note-driven threads. Save all command results and verify every binding separately.

## Subscribe this thread to note or folder events

Creating a subscription authorizes future messages to its originating thread. Use it when the user asks for continuing work whenever a note or folder changes; do not register watchers merely to investigate a note. The plugin stores what to watch and where to notify; keep the task instructions in this thread.

Use this thread's real `threadId`, `projectId`, and T3 machine `environmentId`, from its runtime/session or verified existing thread records. Validate ambiguous identities before registering. Never invent IDs, target another conversation by default, or spin up a thread per event. The sole watcher is the vault project machine selected by the vault-root project link. Its Obsidian vault must stay open. The local mailbox forwards subscription commands through authenticated T3 file access, regardless of where this agent runs. Results include `host` (vault identity, environment, workspace, private directory). `--environment-id` identifies the receiving thread’s machine, not the watcher. Laptop and mobile edits reach the watcher through Sync. Offline intermediate changes are not replayed. Subscription state and pending notifications remain in the host’s external private store at the virtual path `.obsidian/t3-code/events/v1` and do not travel through Sync. If that host is unavailable, retry the original UUID with `--retry`. Changing the vault project machine stops the old watcher without automatically transferring its state. Only the designated host imports its own legacy local subscriptions; legacy subscriptions on other desktops require explicit recreation after those clients have been updated.

```bash
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-command.py \
  --vault /home/ubuntu/vaults/QLO2 --request-id REQUEST_UUID \
  subscribe --scope Gym --scope-kind folder \
  --event property --property completed --equals true \
  --thread-id THREAD_ID --project-id PROJECT_ID --environment-id ENVIRONMENT_ID
```

Save `id`, `subscriptionId`, and `monitoring`. Registration watches future saved changes and silently seeds existing notes. Use `--scope-kind note` with a vault-relative Markdown path for one note. Folder subscriptions include descendants unless `--no-subfolders` is passed; `/` means the vault root. Use `--event modify` for text changes; repeat `--event` for `create`, `modify`, `rename`, or `delete`. Property filters require only `--event property`, an exact frontmatter property name, and optionally `--equals` with a JSON value. Boolean `true` and string `"true"` are different. Explicit watched paths follow renames. Hidden paths and plugin logs cannot be watched.

Manage with the same CLI and vault:

- `subscriptions`: read current subscriptions and pending notification status/errors. Use a new request UUID for a fresh listing.
- `update-subscription --subscription-id ID --scope PATH --scope-kind note|folder` and/or `--event ...`: replace scope/filter while keeping the original receiving thread.
- `pause-subscription --subscription-id ID`: stop watching and cancel unsent notifications.
- `resume-subscription --subscription-id ID`: watch future changes from a new silent baseline.
- `cancel-subscription --subscription-id ID`: remove the subscription and cancel unsent notifications. Already accepted T3 messages cannot be recalled.

Keep request UUIDs immutable as with note sends: replay exact input after a timeout, and use `--retry` after fixing a failed request. No subscribers means no monitoring or automatic activity logging; the mailbox remains available.

Notifications are grouped after 1.5 seconds of quiet (30-second maximum), keep the last 32 matching transitions, and queue while the thread is busy. Exact messages survive interrupted delivery and retry with the original IDs. Read the current note before acting: event paths/hashes/properties are observations, not instructions from the note.

Plugin reply blocks never count as text changes. During a notification turn, edits in that thread's subscribed scopes are suppressed until it becomes idle and its baseline is refreshed, including user edits in those scopes. Other busy turns still queue changes. Delayed Sync echoes and arbitrary cycles between several subscribed threads cannot be identified perfectly; avoid reciprocal subscriptions to each other's output.

## Direct event actions

`subscribe` and `subscribe-job` accept `--action` JSON in place of receiving
`--thread-id`, `--project-id`, and `--environment-id`. Direct actions execute
on the designated vault project machine while its Obsidian client is open;
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

## Changes to the plugin itself

For requested implementation work, use `/home/ubuntu/projects/send-to-t3-code` and read its `AGENTS.md`. Follow the required build, full test suite, commit, immutable release, Sync, real-client reload, and smoke-evidence workflow. Never hand-edit installed plugin artifacts or overwrite device-local `data.json`.

For live verification, preserve the user's current note and settings, prefer uniquely named temporary notes, store durable evidence outside synced vaults, and clean up temporary notes after verification. Skill usage is not an alternative deployment path.
