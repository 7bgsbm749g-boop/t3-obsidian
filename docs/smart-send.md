# Smart Send

Smart Send replaces the former full-note/selection split. Every manual note,
selection and typed Ask uses the same confirmed source record for its note,
destination machine, project and thread. The command bar remains a direct Ask
surface. Note and editor menus also provide the bottom Ask composer.

Only additions are sent, in current note order. Removals produce no message;
replacement text is added text with no correction/deletion labels. Preparing a
request does not confirm coverage. The immutable request captures its source
and covered character intervals before dispatch; confirmed T3 acceptance
records that exact capture, including acceptance recovered after a local error.
Typing during delivery is not included in that capture.

Unchanged lines map coverage to the current note, with common prefixes and
suffixes inside changed intervals. Repeated lines retain occurrence counts.
Explicit selections cover only their requested intervals. New destinations
start with no coverage. Typed questions always send independently of source
coverage. An Ask about already delivered selected source includes a bounded
160-character reference. An explicitly selected generated reply remains
available as quoted Ask context, including when choosing another thread.
No new source for the default destination opens the selector and
hides its previous/continue action; an explicit empty submission shows the
short no-content notice.

Before allocating an editor stream, every Send and Ask checks the selected
machine, project, thread, and active provider turn against the responses still
attached to the destination note. A matching response is steered in place and
keeps its original streaming and formatting choices, including when the new
draft has streaming switched off. The steering transcript uses the same
prepared source delta and question as the delivered message. Mirrored notes
reuse their own matching streams; only new destinations receive new blocks.
Completed responses and explicit new threads receive independent blocks.
After a reload, an attached response with no recovered turn proof must reconnect
before another send. Several matching streams require an explicit response
choice. This prevents an uncertain match from creating another copy.

`data.json.smartSend` holds stable note identities, compressed current source
snapshots, confirmed heads, retirement IDs, and response records. A snapshot
successor retires only the heads it observed. Merge retains independent
confirmed branches and unions their coverage on the next send. Retirement IDs
prevent stale settings from restoring superseded heads. A local replica repairs
stale whole-settings replacements. Note identities follow rename and deletion.
Rename records retain a separate move revision, so a receiving client's later
deletion of the old Sync path cannot overwrite the rename. If a client missed
the move, a uniquely located response binding can reconnect its confirmed
source history when the old note no longer exists. Accepted source receipts
retain these binding IDs across later sends. Older receipts can use their
deterministic source binding ID. Copies with an existing original and ambiguous
response locations do not inherit the original's coverage. Independently
discovered identities at the verified new path share coverage and saved reply
exclusions; new threads still start with no coverage.
This is not a cross-device delivery lock: simultaneous unsynced sends can both
be accepted before either device receives the other's receipt.

Completed and frozen response bodies are recorded before their checked native
write. Rendered output, including progress and input echoes, is stored once by
SHA-256; gzip is used when its base64 form is smaller than the original text.
Current source snapshots use the same encoding. No new markers, comments or
boundaries are written to Markdown. Full body matches exclude saved responses;
unique surrounding text can locate edited responses and retain user additions.
Active response containers and recognized generated progress callouts are also
excluded. Ordinary quotes and literal marker examples remain source.

Older note replies can be recovered from canonical T3 snapshots for their known
note/thread bindings. Only complete-line, unique rendered matches are recorded;
recovery does not rewrite the note. Arbitrary unmarked or independently edited
historical prose without a verifiable source cannot be classified perfectly.

Verification covers additions and removals, selections, repeated lines, source
edits during sending, question-only sends, response edits, compression, device
branch merging, stale settings, note lifecycle, selector behavior, composer
drafts, and the actual bundled Send/Ask preparation. Release smoke evidence is
recorded through the supported QLO2 release receipt. VPS desktop results do not
establish native iPhone or Android keyboard and selection behavior.

Rename regression evidence (2026-10-20) is retained under
`/home/ubuntu/backups/send-to-t3-code/smart-send-rename-20261020`.
The desktop check sent a real bounded prompt, renamed its note locally, and
verified the next T3 message contained only its addition. A second desktop
renamed the note through official Headless Sync; the next real delivery again
contained only the addition. Configuration Sync carried the synthetic source
records separately from the note. This covers desktop file propagation and
actual plugin delivery, not desktop core Sync or native mobile behavior.

The reusable fixture is `scripts/prepare-smart-send-rename-lab.mjs EVIDENCE_DIR
SYNTHETIC_PROJECT_ID`, with the two lab desktop clients closed during setup.
It backs up their existing plugin files and enablement, installs only in those
synthetic vaults, and gives its observer a private command directory outside
Sync. Use `--restore` with the same evidence directory after deleting all
fixture notes through Obsidian, checking Sync deletion, closing the lab clients,
and deleting the bounded T3 test thread. Restore the lab's original Sync
configuration after any configuration-Sync check. Never use this fixture in
QLO2.
