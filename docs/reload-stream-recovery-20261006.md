# Stream and project-link recovery after a folder round trip

## Observed production fault

The laptop QLO2 report covered missing streams and the Send to T3 Code project
link after an app reload and restart. Read-only investigation retained both
machines' note files, host leases, immutable generation revisions, and official
Sync server history outside the vault:
`/home/ubuntu/backups/send-to-t3-code/investigations/reload-stream-loss-20261006T185425Z`.

The plugin recorded the project folder moving from `Projects/Side/…` to
`Projects/newgame_/Side/…`. The actual folder returned to its original path,
but its saved project link retained the absent destination. The host's stale
rename cleanup removed two active response anchors at 18:49 UTC before proving
that the new destination existed. Official Sync history attributes those note
writes to the VPS. Both source threads remained running and their reply text
remained in the host journal. A third note retained its response identity, but
ordinary text inside its saved empty anchor prevented native projection.

These observations identify the saved-state fault. They do not establish that
Reload app without saving itself initiated the folder move.

## Changes

- Native response checkpoints retain the authority's destination instead of
  replacing it with a cached writer path. The epoch/revision check remains.
- Stale-source cleanup requires the destination's saved empty anchor first.
  A delayed or reversed move retains the sole surviving registration.
- Native reverse moves update the response locator's destination immediately.
- Folder moves record explicit link mutations before an asynchronous save.
  Each reverse move supersedes the earlier unlink tombstone, including across
  stale Sync settings and restart.
- `repair-response --hash REVIEWED_HASH` can repair an active native response.
  Missing anchors require the exact journaled original with only that anchor
  removed. Text inside intact boundaries is preserved outside the restored
  empty anchor. A private immutable before/after record precedes the checked
  native save. Changed hashes, changed placement, divergent editor buffers,
  canceled responses and completed responses retain their existing guards.
  Recovery corrects a stale relocation trail and resumes the existing binding;
  it does not resend the prompt or create a replacement thread.

The live third binding finished before its queued repair. Its generation was
an unsaved conflict, with no commit attempt or verified materialization. Release
2.34.5 preserved that note and returned the existing conflict. The follow-up
allows the same checked anchor normalization for that narrow finished state,
then passes the normalized saved hash to the ordinary result conflict repair.
Committed results and pending commit intents do not enter this path. Its real
preimage, including `its ` inside the markers, remained unchanged during review.

## Validation

Five fault regressions failed before the fixes; the corrected authority fixtures
also fail against the original authority source. Nine targeted regression checks
passed after the fixes. They cover delayed destination arrival, a folder round
trip across host restart and final delivery, stale writer paths, same-path
location repair, native reverse moves, queued folder-link saves with stale Sync
and restart, active anchor recovery, text preservation, and refusal of unsafe
repairs. The reviewed recovery build passed, together with all 932 JavaScript
and 11 Python tests. Build, suite, release and live-smoke records are retained
beside the investigation evidence.

The unreleased stream-close feature was preserved separately and excluded from
this recovery release. Live verification must use the new immutable release and
real QLO2 client. Native Windows visual verification depends on the laptop's
available computer-use tools; file propagation and loaded-client status are
reported separately from visible editor evidence. No native mobile behavior is
established by this work.

## Retained release checks

Release 2.34.5 passed 932 JavaScript and 11 Python tests, installed exact
immutable bytes with settings preserved, and has a complete VPS QLO2 smoke
receipt. A native active folder move and return kept identical saved anchor
bytes and the direct link. The bounded delivery completed and saved; a checked
app reload executed after completion and visibly retained the same note.
Both lost-anchor user responses completed exact host-verified saves, with
ordinary prefix/suffix bytes unchanged and both desktop actor acknowledgements.
Laptop inspection verified the restored project link and loaded 2.34.5.

The completion-race regression fails against 2.34.5 and passes with the follow-up.
The follow-up build and all 933 JavaScript plus 11 Python tests passed.
Final release and third-note recovery evidence will be recorded outside the
vault with the existing investigation artifacts.

## Approved startup display recovery

The user separately approved the display proposal after reviewing it. Before
this change, native records and direct display bodies were held only in memory.
Reload cleared them, and drawing the surviving empty anchors required fresh
remote catalog and lease reads. Permanent saved-state repair alone therefore
did not establish uninterrupted active display after reload.

The native display manager now retains only the binding identity, current prompt,
validated body, placement and epoch/revision/sequence in the existing device-only
IndexedDB store. Startup loads this bounded snapshot before host discovery. It
projects the body only into the exact empty native anchor in the same vault and
note, with Reconnecting until fresh data arrives. Restored entries never enter
the device writer manager, host authority or final-commit proof maps. No prompt
is resent, ownership changed, settings rewritten or generated body saved into
the note. Existing native projection still preserves ordinary editor saves.

A prior direct preview is retained through delayed host prose and earlier direct
events. Fresh matching events replace it. Stop, saved completion, location
conflict, changed prompt identity, note deletion and removed or changed markers
invalidate display evidence. Native rename changes its local placement. Writes
are coalesced at 500 ms and use the existing private database; storage failure
does not stop normal streaming or final saves. The bounded cache holds at most
32 replies and eight million body characters. A device with no validated prior
preview, unavailable local storage, or changed anchor cannot use this shortcut.
The guarantee starts when the native editor is ready; it does not remove the
app's own startup screen or assert that cached data is live while offline.

Ten integration regressions cover multi-stream/multi-pane reload without host
reads, ordinary saves, delayed host and direct data, stop and late events,
changed boundaries, malformed cache and vault/prompt mismatch, native completion,
rename, deletion and storage failure. The original startup code fails the first
seven new reload regressions. Build, full suite and active native reload evidence
are retained outside the vault before the release is marked complete.

The first live cache smoke on 2.34.7 captured the retained reply and Reconnecting
in the ready native editor during an active checked reload, while saved Markdown
kept the same empty-anchor preimage through the final verified commit. The same
T3 delivery completed CACHE RELOAD VERIFIED. It also exposed a Markdown grouping
issue: the reconnect label absorbed the cached callout into its quote. A real
Markdown parser regression reproduces it; the follow-up separates the banner
from the original cached Markdown block. Release 2.34.7 evidence is retained
unchanged. The layout correction uses a strictly newer immutable release.
