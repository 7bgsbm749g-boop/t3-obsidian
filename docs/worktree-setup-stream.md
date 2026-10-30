# Worktree setup in the editor stream

Workspace preparation uses a dedicated panel in Live Preview and Reading view,
with T3's stage names, completed/skipped/error icons, active-stage animation,
checkout percentage, elapsed times, script-output tail, and a closed Details
disclosure for branch, base, path, and setup command. The normal tool groups no
longer list the server's synthetic `Preparing workspace` command.

The panel is transient: successful completion or the canonical agent-start
timestamp removes it from both the live stream and retained response history.
The start timestamp also handles a delayed final setup snapshot. Failed and
cancelled setup remains available for diagnosis.

The orchestration transcript identifies preparation by its reserved
`workspace-preparation` item ID and exact command input. A normal command with
the same label remains a normal tool. `watchThread` lazily subscribes to T3's
native `subscribeWorktreeSetup` RPC on the existing authenticated socket. Its
snapshot sequence is independent of the orchestration cursor. Reconnects
resubscribe; title-only listeners do not subscribe; optional-channel failures
leave the transcript connected. Snapshot validation requires the exact thread
and known stage/status values and bounds the script tail.

The latest setup snapshot survives transcript polling and response checkpoints.
Stage clocks update in each client's DOM without rewriting note text. Details
and stage nodes retain their identities during streaming. Stop and terminal
rendering remove active effects and freeze clocks. A retained snapshot is used
only for an overlapping preparation interval. If an older thread has no retained
setup snapshot (for example after a server restart), completed preparation is
omitted. Pending or failed preparation uses the known transcript details without
inventing stages or durations.

## Verification

`tests/worktree-setup.test.ts` covers transcript adaptation, identity matching,
separate cursors, checkpoint recovery, escaped metadata/output, progress,
failure, and Stop. `tests/thread-stream.test.ts` covers the optional native
subscription, acknowledgments, reconnects, and unrelated-thread rejection.
The affected-check runner also selects the transitive editor/response consumers.

Build an isolated native fixture with:

```sh
node scripts/build-native-response-lab.mjs evidence/TASK --worktree-setup
```

Launch the returned Obsidian profile through Cua. If Obsidian shows its
first-open trust prompt, trust only this newly built fixture vault to enable
the validation plugin. Use the software-rendering flags described in
`worktree-handoff-continuation.md` if desktop capture is stale. `RESULT.json`
records the Live Preview and Reading assertions, and native screenshots retain
the running and completed panel. `CLEANUP.json` must report no remaining notes
and no temporary threads before this evidence is used for release smoke.
Fixtures never use QLO2 or Obsidian Sync. Native mobile is not covered.
