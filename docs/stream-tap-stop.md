# Tap to reveal Stop on an active response

Click or tap plain content in an active response callout to reveal a square
Stop button at its top right. Keyboard focus on the plain response widget also
reveals it. The title, Follow chevron, links, buttons, form fields and other
interactive controls do not reveal Stop when clicked or focused. This also
applies when a control redirects pointer focus to the containing native widget,
so Follow stays in place throughout its click. The native button
has a `Stop T3 response` accessible name, a visible focus outline and a compact
24 × 24 CSS pixel target with a 14 × 14 square icon. It uses Obsidian's native
icon-button styling with a transparent resting background. It stays centered
on the natural header while the separate follow action can move to the bottom.
The header has no forced minimum height.

Only the currently selected response in its Markdown pane reveals Stop.
Clicking or tapping outside it, selecting another response, or moving keyboard
focus outside it dismisses Stop. Internal focus transitions, including focus
into Stop, keep it usable. There is no dismissal timeout or saved reveal state.
Follow moves aside and title space is reserved only while Stop is visible;
both return immediately when it is dismissed. The controller does not write
note content or intercept ordinary selection, links, folding or touch scrolling.
The first reveal click does not activate Stop.

Activation rechecks the current response identity and uses the existing
`InlineChatManager.stopAt` path. This retains the visible transcript and uses
the established exact-run interrupt/cancel and retry logic. Concurrent replies
keep separate identities. The button is removed for terminal previews,
completed/saved responses, stopped responses and ambiguous or blocked views.
Terminal eligibility is separate from the displayed fold key: a completion
can arrive before its rendered text changes.

## Interactive-control correction verified on 2026-10-30

Stop reveal ignores the title, Follow, links and other interactive descendants,
including their nested icons and keyboard focus. A pointer gesture on a control
also suppresses reveal if Obsidian redirects focus to its native response widget.
Plain content still reveals Stop; the editable editor ancestor and focusable
response wrapper do not count as controls. Existing visible Stop controls remain
usable, and pointer cancellation or keyboard navigation clears gesture state.

`npm test` passed its selected checks and required build. Three controller
regressions cover control clicks/focus, redirected widget focus, and editor
ancestor boundaries. Native Obsidian 1.13.7 clicks in the isolated test vault
verified Follow with Stop hidden, title collapse/expand with Stop hidden,
plain-content reveal, one exact synthetic Beta interrupt and reference navigation.
Reveal and control clicks preserved saved note bytes. All three fixture notes
were deleted through the vault API; no real T3 threads were created. These are
desktop fixture checks, with no native iPhone or Android coverage.

Evidence and tested source hashes are in this task worktree's gitignored
`evidence/stream-stop-click-20261030/behavior.json`. QLO2 receives no test content;
its release, fresh Sync and loaded-client verification use the release queue.

## Compact-button correction verified on 2026-10-24

- `npm test` passed the affected-system checks and required build. The final
  validation selected 160 test files, executed 16 and reused 144 matching checks.
  Seven controller regressions include immediate outside click/pointer/focus
  dismissal, response and pane switching, internal focus transitions, activation
  followed by blur, header centering, single-flight stopping and stale identity.
- An isolated Obsidian 1.13.7 editor compared the old and corrected controller
  and CSS using the same synthetic document, pane, dark theme and native input.
  Before: Stop was 44 × 44, with a forced 44px header and permanently shifted
  Follow. After: Stop is 24 × 24, its SVG is 14 × 14, and the short header is
  naturally 22px tall both hidden and revealed. Stop and Follow share its center.
- Native clicks verified initial hidden/normal Follow, reveal, click-away and
  restored Follow, switching between two independent response boxes, expanded
  and collapsed boxes, and wrapped titles in a 480px-wide desktop window.
- Native Tab and Shift+Tab verified focus into Stop, internal transitions and
  dismissal outside. Enter sent exactly one synthetic `thread.turn.interrupt`
  for `thread-0` / `run-0`. The other stream accepted new tokens independently;
  terminal state removed its control. Drag selection and reference navigation
  remained usable. Saved Markdown and response anchors were retained.
- All three fixture notes were deleted through Obsidian vault operations and
  their absence was verified. No real T3 threads were created. QLO2 received no
  fixtures or evidence. Narrow desktop coverage does not establish native
  iPhone or Android behavior; those platforms were not tested. The recording
  transport tests exact-run dispatch, not authenticated provider delivery.

Evidence, rendered comparisons and the cleanup receipt are outside synced
vaults under
`/home/ubuntu/backups/send-to-t3-code/compact-stop-20261024T035223Z/`.
`behavior-evidence.json` records the tested source hashes and individual files.

## Original verification on 2026-10-20 (historical)

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

## Delivery on 2026-10-21

The initial release pause ended when the user authorized committing the four
existing documentation edits. Commit `9c5a47b` preserved those edits, and
`d17a149` integrated the reviewed Stop button source. No dirty override was used.

The supported release command built and tested immutable **2.45.25**, installed
it in the development vault and QLO2, and required a fresh `Fully synced` scan.
Both installations matched the archive hashes; both `data.json` files remained
byte-identical. Commit `98c988b` records the version files.

QLO2 Obsidian 1.14.4 loaded plugin instance
`b8680dc5-3033-4be7-bfeb-a4ed0c03e5f9` at version 2.45.25 after the supported
native reload command. A native click in the existing interrupted response
showed no Stop control. The existing note bytes, all 43 pane IDs, active pane,
and plugin settings were preserved. The General settings window was restored;
the temporarily enabled native command interface was restored off.

The positive active-stream checks remain the separate test-vault checks above.
QLO2 received no test content. No real T3 test threads were created, and all
isolated fixture notes were removed. Native mobile remains untested.

Completed immutable receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.45.25/smoke-vps-qlo2.json`.
Deployment/reload/native evidence:
`/home/ubuntu/backups/send-to-t3-code/stream-stop-delivery-20261021T012041Z/smoke.json`.
