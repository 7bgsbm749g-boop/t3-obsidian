# Editor boundary and completed rename recovery

## Report and retained evidence

The report covered typing/deleting next to a response tracking comment and text
missing after restarting Obsidian. A second screenshot showed a renamed note
with only an empty response anchor. Before changing notes, the investigation
preserved Markdown files, response records, and both desktop recovery databases
outside the synced vault.

Evidence root:
`/home/ubuntu/backups/send-to-t3-code/investigations/editing-loss-20261006T175037Z`.

The renamed note's complete 156,423-byte final document remained at its original
filename. Its SHA-256 matched the authenticated delivery record exactly:
`397a3f12ac75087bc0fefedb6e5459fc79391eb48704fbf59764d1d0bb557151`.
Recovery compared the destination against its preserved 123-byte empty anchor,
then restored the verified final document atomically. The original complete
file was retained. The laptop independently verified that Sync delivered the
restored document with the same hash.

The other note contained the same 176 bytes on both devices. Its recovery
snapshot and preserved local conflict did not contain the reported extra
writing. That writing has not been recovered. These observations do not prove
what was present in the editor before restart. Read-only official Sync server
history was subsequently inspected for both the original `Untitled 7.md` path
and the renamed path. The creation/edit versions before the incident contain
only the complaint, image link, and empty response anchor, not the reported
extra writing. The new text and conversation added after the incident were
preserved without replacement. Server history and pulled plaintext versions
are retained as `sync-server-history.json`, `sync-history-versions.json`,
`sync-history-old-path.json`, and their referenced files in the evidence root.
No restore or push was issued during that inspection.

## Causes and changes

Response parsers required each tracking comment to occupy an entire line. The
native editor allowed ordinary insertions at the outer edges of a response.
Such an insertion invalidated the parser, so later transaction filtering and
saved-document projection could throw. Complete comments are now recognized
next to ordinary text. Code examples, duplicate boundaries, reversed boundaries,
and partial response edits retain their existing protections. The transaction
filter also checks the proposed document before accepting an outside edit that
could duplicate a marker or wrap an active response in a code fence.

Final delivery previously treated ordinary insertions touching either outer
edge as a merge conflict. Only the checked final response replacement now
preserves these exact outside insertions; other touching edits remain conflicts.
The first production smoke also exposed a combined case: inserts at both edges
change both marker lines, so the line-based diff could group them with the whole
unchanged response. The merge now uses the exact unique recorded response
preimage as an unchanged diff anchor. Repeated or changed preimages remain
conservative conflicts. The original live conflict, both saved ordinary edits,
and completed reply are retained in the evidence root. Release 2.34.3 remains
`awaiting-live-smoke`; its bytes are immutable.

Completed deliveries retired their polling job and therefore stopped forwarding
native renames. A lightweight binding index now retains rename routing after
completion. The host journals a one-time completed rename intent. If the new
file arrives late through Sync and is byte-identical to the recorded pre-commit
document, the host preserves that preimage and restores the verified final
document through the existing checked save path. Changed user text remains a
conflict. The intent survives host restart and is settled after observation, so
a subsequent undo does not trigger repeated restoration.

## Verification scope

Regression tests use real CodeMirror transactions for repeated boundary typing,
deletion, save projection, stream refresh, and reopening. Host tests cover final
delivery with text touching each outer edge, retired completed bindings, delayed
rename propagation across restart, preservation of changed user text, and a
later undo. The pre-fix boundary regressions failed before the parser changes.

The first release build and full suite passed: 910 JavaScript tests and 11 Python
tests. After the combined-edge live regression, the next full build and suite
passed 921 JavaScript tests and 11 Python tests, including the concurrent reviewed
project-link changes. The exact logs are retained in the evidence root.
An isolated real Obsidian 1.13.7 desktop editor accepted native keystrokes at
both outer comment edges, continued to accept typing/deletion, saved ordinary
text without transient stream output, and showed that text after reopening the
note. Evidence is at
`/home/ubuntu/backups/send-to-t3-code/investigations/editing-native-20261006T180400Z`
(`BUILD-SOURCE.json`, `interaction.json`, and application screenshots). This
fixture covers the boundary parser changes, not production deployment.

The official real-Sync transport smoke also passed create, edit, rename, delayed
reconnect, and delete propagation between the two independent lab vaults:
`/home/ubuntu/backups/send-to-t3-code/sync-test-lab/20261006T182919Z-1c538031/smoke.json`.
This establishes file transport only; it does not establish the plugin repair,
desktop core Sync behavior, or native phone behavior.

Native desktop and QLO2 release smoke evidence must be retained outside the
vault and recorded with the immutable release receipt. Unit tests and matching
files alone do not establish visible editor adoption. This investigation does
not establish native iPhone or Android behavior.
