# Tap to reveal Stop on an active response

Click or tap an active response callout to reveal a square Stop button at its
top right. Keyboard focus inside the callout also reveals it. The native button
has a `Stop T3 response` accessible name, a visible focus outline and a 44 × 44
CSS pixel target. It stays at the top while the separate follow action can move
to the bottom. Header space prevents the controls from covering the title.

The controller stores reveal state per response, fold and Markdown pane. It
does not write note content or intercept ordinary selection, links, folding or
touch scrolling. Reveal happens on click, after the first tap has its target,
so a tap where the button will appear cannot accidentally press Stop.

Activation rechecks the current response identity and uses the existing
`InlineChatManager.stopAt` path. This retains the visible transcript and uses
the established exact-run interrupt/cancel and retry logic. Concurrent replies
keep separate identities. The button is removed for terminal previews,
completed/saved responses, stopped responses and ambiguous or blocked views.
Terminal eligibility is separate from the displayed fold key: a completion
can arrive before its rendered text changes.

## Verification on 2026-10-20

- `npm run build` passed, including the final control spacing and fixture.
- `npm test` passed: 1,203 JavaScript tests and 19 Python tests.
- Four new regression tests cover lifecycle/identity validation, pointer and
  keyboard-focus reveal, selection/link event defaults, retained DOM state,
  stale activation, single-flight dispatch, failure/retry and disposal.
- `node scripts/build-native-response-lab.mjs PRIVATE_EVIDENCE_DIRECTORY
  --stream-stop` prepares an isolated real Obsidian fixture. Its provider
  snapshots and interrupt transport are synthetic; it has no provider
  credentials or permission to send real T3 work.
- Native input in Obsidian 1.13.7 verified click reveal, a 44 × 44 button,
  non-overlapping follow/Stop controls, drag selection, reference navigation,
  keyboard focus, exact `run-0` interruption and continued Beta updates.
  A terminal Beta preview lost Stop even with unchanged active-looking text.
- Obsidian 1.14.4 verified click reveal, Tab navigation and Enter activation:
  only `run-1` was interrupted; Alpha retained its independent control.
- Saved note bytes and both durable anchors stayed unchanged during reveal
  and the synthetic interrupt checks. The production stop/save mechanism was
  reused; this fixture does not prove authenticated delivery or final saving
  through a real provider.

Text can be selected after revealing Stop. A selected DOM range cleared when
new tokens were appended. The same check with Stop controls disabled also
cleared the range in Obsidian 1.14.4. These checks establish selection during
interaction, not persistent browser selection across token renders.

All temporary notes (`Stream stop fixture.md`, `Reference.md`, `Virtual.md`)
were deleted through Obsidian vault operations. No real T3 test threads were
created. Both test runs' cleanup receipts and filesystem checks confirm absence.
QLO2 received no test notes, settings changes or evidence. There was no Sync,
desktop core Sync engine, native iPhone or native Android test.

Evidence is outside every synced vault:

- `/home/ubuntu/backups/send-to-t3-code/stream-stop-full-tests-20261020.log`
- `/home/ubuntu/backups/send-to-t3-code/stream-stop-native-20261020/verification.json`
- The same directory contains native screenshots, source hashes, exact synthetic
  interrupt payloads, selection observations, and cleanup receipts.

## Delivery state

Source is committed in the task worktree. Integration and release require the
canonical checkout to be clean. Its unrelated edits to `AGENTS.md`, `README.md`,
`docs/obsidian-sync-test-lab.md` and `skills/obsidian-t3/SKILL.md` remain intact.
This task does not stash, discard or commit them and does not use `--allow-dirty`.
The release preflight observation is retained with the external evidence.

No release version is assigned to this change. The development/QLO2 install,
fresh Sync scan, real QLO2 reload, and immutable completed smoke receipt remain
pending until the release checkout is available. The isolated fixture evidence
must not be used as a completed QLO2 release receipt.
