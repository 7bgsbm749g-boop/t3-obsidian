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
