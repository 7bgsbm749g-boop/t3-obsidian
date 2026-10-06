# Direct device streaming

The coordinated response path previously disabled the device's T3 stream and
displayed only the host's polled lease body. Host migration required the saved
anchor to arrive through Obsidian Sync before the writer could produce that
body. This put Sync on the path to the first visible reply.

`DirectInlinePreview` now consumes the authenticated T3 thread stream after
registration, including while the host record is still migrating. It supplies
native display updates only. It cannot acquire a writer lease, save generated
Markdown, import attachments, or acknowledge a final disk commit. The exact
prompt, project and thread identify the response; the latest unrelated turn
cannot bind it. Delivery evidence reaches the preview before the host mailbox
write is awaited.

The device retains its applied event cursor across reconnects and pane closure.
Older snapshots and duplicate events are rejected. Host checkpoint evidence
does not advance that cursor or replace newer device prose. Native panes retain
the direct body through delayed host updates. The checked final host record
replaces the temporary display; existing proof and disk checks govern adoption
of the saved file. Stop, unload, ambiguous destinations and completion close the
direct feed. The status remains Working during network recovery.

The host also excludes response records whose anchors are absent from the note
when it constructs the note's local projection. Removed historical records can
therefore no longer prevent a present response from saving. Malformed present
boundaries still fail validation. This addresses the reproduced stale-record
failure; it does not establish the original cause of the earlier orphaned
journal promise.

Regression coverage includes migration with no host note, direct transport with
no device note writes or checkpoints, exact prompt isolation, duplicate/stale
events, reconnect cursor retention, late callbacks, stop/completion, native
panes with ordinary edits, final adoption after delayed Sync, and a removed
same-note binding followed by a valid checked commit.

Private diagnostic and validation evidence is retained outside the vault at
`/home/ubuntu/backups/send-to-t3-code/investigations/direct-stream-20261006`.
The complete suite passed: 843 TypeScript tests and 11 Python tests. The
isolated native fixture passed in two real Obsidian panes in Live Preview,
Reading view and Source mode, with host migration still pending and no
generated body saved to disk. It also passed delayed final adoption. Its
screenshots and result are retained at
`/home/ubuntu/backups/send-to-t3-code/investigations/direct-stream-native-20261006-03`.
This fixture uses synthetic stream and host data; it does not prove real Sync
transport or native mobile behavior.
Release and real-client verification must be recorded in the immutable release
receipt. Native mobile behavior requires a separate device test.
