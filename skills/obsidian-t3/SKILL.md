---
name: obsidian-t3
description: "Manipulate or edit Obsidian notes only when BOTH conditions hold: the message was sent from Obsidian, and the user explicitly or implicitly asks to change notes (for example, create, rewrite, insert, replace, move, rename, settle, or organize them). Agents may invoke this skill when both conditions hold. An Obsidian source footer alone never triggers it. Do not use for ordinary chat, questions, explanations, or code/repository work that does not request note changes."
---

# Obsidian notes through T3 Connect

Use this skill when the user's message comes from Obsidian and asks for a note
change. `Sent from Obsidian.`, `Vault:` and `Note:` identify the source; the
footer alone gives no permission to edit or send. For ordinary replies, answer
in the existing thread using the supplied text. The plugin streams and saves
that answer. Do not append a second copy to a note.

Use checked requests to the running plugin for note changes. The agent can be
on another machine. The plugin accesses request files through authenticated T3
Connect, then edits notes with Obsidian's editor and vault APIs. No incoming
laptop connection, Obsidian CLI, vault filesystem write, or Sync command
fallback is needed. The relevant Obsidian client must remain open and connected.
Mobile background delivery is not guaranteed.

The maintained helper is
`scripts/obsidian-command.py` in this skill’s owning repository. Resolve the
installed skill directory to its real path; the repository is two directories
above that directory. In the examples, replace `REPOSITORY` with that root.
Run it on the T3 machine handling this conversation. `--vault` accepts the exact
vault name or UUID; an absolute local vault path can identify a desktop client.
It reads only client registrations outside the vault. Its default transport
root is the T3 base directory's `scratch` workspace. For a different No project
workspace, get the exact root from T3's project metadata and pass
`--transport-root ROOT`. Do not infer a vault path from a project checkout.

If more than one client matches, use `connected-clients` to get the nonsecret
client IDs and pass `--client-id ID`. Select the intended device; do not send the
same mutation to several devices. Never display registration tokens. Request
and edit files belong on the T3 machine outside every vault.

## Read the right note and reply destination

For a request about the original send or its reply, use `note-context NOTE.md`.
Add `--thread-id`, `--message-id`, and `--environment-id` when several sends
match. This returns the exact source and response bindings, including destination
note paths. The source note and the reply destination can differ.

To obtain current content for an edit, use `prepare-note-edit`. Pass an active
`--binding-id` when the destination contains a response block. Do not guess a
binding, use a thread ID as a binding, or read another vault after a lookup fails.

## Prepare and submit a checked edit

```sh
python3 REPOSITORY/scripts/obsidian-command.py \
  --vault VAULT --output /agent/work/edit.json \
  prepare-note-edit 'Folder/Note.md' --binding-id BINDING_ID
```

Omit `--binding-id` for an ordinary note with no active response. The JSON result
contains `editId`, `original`, `originalHash`, and protected response IDs. Save
`original` exactly to an agent-owned working copy outside the vault. Edit that
copy. Preserve every active response block, its boundaries and order exactly;
change only the requested ordinary note content.

```sh
python3 REPOSITORY/scripts/obsidian-command.py \
  --vault VAULT --request-id SUBMIT_UUID \
  submit-note-edit --edit-id EDIT_ID --hash ORIGINAL_HASH \
  --proposed-file /agent/work/proposed.md
```

For a streaming reply, `status: submitted` means the proposal is attached to its
safe final save. It does not mean the note has been saved. Compatible user edits
made since preparation are merged. Conflicts preserve both the note and proposal
and stop that save. Stop still reaches T3 and uses the same checked final-save
path for a frozen reply.

Submit **before finishing the current reply**. Waiting for that reply's final
save inside the still-running reply can prevent it from finishing. Say the edit
is submitted when that is the confirmed state. A later
`note-edit-status --edit-id EDIT_ID` can confirm `saved`. Ordinary notes can save
immediately through a checked write. If the reply finished, moved, or changed
before submission, prepare the current note again and review the preserved
proposal. Never replace a failed merge with a raw vault write.

Keep the same request UUID for an unconfirmed retry. Use `--retry` only after a
confirmed failure and inspection. An interrupted dispatch stays ambiguous and
cannot execute again automatically. Do not create a replacement send to work
around a missing acknowledgement. Completed command receipts remain private
for 24 hours; never reuse old request IDs for new work.

## Create, move, or rename

`create-note 'Folder/New.md' --proposed-file /agent/work/new.md` creates an
ordinary Markdown note through Obsidian and refuses an existing destination.
The parent folder must exist. It cannot create response blocks.

For a move or rename, prepare the source first and use its current checksum:
`rename-note 'Draft/Note.md' --note-path 'Settled/VERSION Note.md' --hash HASH`.
Obsidian performs the rename and normal link updates; an existing destination or
changed source is refused. A settle request uses the project's existing Settled
folder and prepends the version actually delivered to the existing title.
Preserve note content and response anchors. Rename before preparing a content
proposal so its snapshot uses the final path.

## Other explicit plugin operations

Use `--help` for complete current arguments. Note sends require an actual user
request to send: `send-note NOTE.md` creates or continues a T3 conversation;
`attach-response NOTE.md --thread-id THREAD --message-id MESSAGE` attaches an
existing reply without sending another prompt. Destinations use repeated
`--destination NOTE.md` and optional `--destination-section HEADING`.

`inspect-folder`, `link-folder`, and `unlink-folder` manage project routing.
Linking requires exact project, connection and environment IDs. Thread-wide
following remains explicit: `stream-thread --stream-scope thread` with source
IDs and destinations; `thread-streams` lists its registrations. Pausing,
resuming, cancelling and removing one destination do not dispatch prompts.
Automatic note, property, folder and job event subscriptions have been removed.

Read-only response status and explicit response recovery commands remain.
`client-status` and `send-failure-log` do not change notes. `reload-client` is a
maintainer operation for an authorized exact release; it requires complete
runtime hashes. An acknowledgement is not proof that the new client loaded.
The external helper retains only the old maintenance endpoint for upgrading an
older installed client; note edits and sends always use the connected protocol.

A conflicting proposal can be withdrawn with `cancel-note-edit --edit-id EDIT_ID
--hash CURRENT_HASH`. Read `note-edit-status` first to obtain the current note
checksum. This removes only the pending proposal; it does not undo saved text.
To save a retained frozen reply, use `response-recovery-info --binding-id ID`,
then `retry-response-save --binding-id ID --hash CURRENT_HASH`. The same checked
writer runs again without sending input or another remote Stop. Conflicting
text must be reviewed; these commands never force an overwrite.
