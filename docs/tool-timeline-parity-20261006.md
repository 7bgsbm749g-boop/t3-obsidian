# Tool activity and grouped history

The Obsidian reply now uses T3's distinction between a tool result and the
current activity label. The latest successful tool can still label the live
activity while the turn runs; expanding its dropdown shows the completed
result. New prose, reasoning, user input, another tool batch or turn completion
replaces that presentation. Thoughts now join the same activity batch as tools;
see [the current grouping contract](thought-groups.md). Failed, declined and stopped results retain their
outcomes.

Earlier consecutive calls use closed action-summary dropdowns. The requested
example is **Ran 4 commands and changed 7 files**, with a hammer icon for the
mixed batch. The counts come from canonical tool identities and distinct file
paths, not from assistant prose. Mixed summaries use T3's first-seen action
order and sentence punctuation. Read, browser, device, search and pull-request
actions have separate counts. Expand a batch to see its individual calls and
their exact commands, escaped results, directories, exit codes and durations.

The current dropdown remains below the history callout and appears only once.
Its result nodes and user expansion survive dense display updates. When a new
timeline entry follows the batch, the batch moves into history. Stop preserves
the displayed results, marks unfinished calls stopped and removes animation.
Command and output blocks retain a Copy control in both locations.

## T3 source references

Compared against `/home/ubuntu/projects/t3-code-forklauncher`, commit
`4701b9bd2f4c407aba2d46dfefcd32a357b8996c`:

- `packages/client-runtime/src/work-log/presentation.ts`:
  `liveActivityToolStatus`, `toolGroupAction`, `toolGroupActionCount`,
  `toolGroupActionLabel` and `summarizeToolGroup`.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts`:
  `liveWorkEntryLabel`, trailing active-tool grouping and historical work groups.
- `apps/web/src/components/chat/MessagesTimeline.tsx`:
  live activity animation, collapsed work toggles and summary icons.

The installed T3 client also uses the same completed-to-live presentation rule.
The Obsidian adapter retains its own native Markdown callouts, checked final
delivery and 80 ms display clock. It does not change T3 execution or Sync.

## Verification

Regression tests cover the exact command/file sentence, file deduplication,
sparse lifecycle results, turn isolation with reused IDs, chronological batch
boundaries, concurrent tools, live completed results, failure outcomes and Stop.

The source-only native fixture uses two editor panes, 77 small token deltas,
Live Preview, Reading view and Source mode. It checks ordinary selection,
editing, undo, clipboard copying, user expansion, actual result statuses,
default-closed groups, the exact requested summary, clean saved projections
and final adoption. All 25 native checks passed in retained run `native-3`.
The replay sampled 39 frames with zero missing, closed or replaced history
boxes and current tool groups. The build and all 904 JavaScript and 11 Python
tests passed.
An initial run exposed the missing native Copy control outside callouts; that
control was restored before delivery. Retained evidence is under
`/home/ubuntu/backups/send-to-t3-code/tool-groups-20261006/`.

The full build, complete test suite, immutable QLO2 release and a real QLO2
delivery must pass before the release is marked complete. The live release
receipt records runtime hashes, Sync, client reload and final smoke evidence.
These checks cover the VPS desktop client. Native iPhone and Android behavior
was not tested.

The first QLO2 delivery in 2.34.2 saved the exact requested summary and checked
final reply. Subsequent pointer clicks did not reliably close the batch. A
separate repair thread is investigating an editor/save lockup; those clicks
do not establish a dropdown-specific cause. Code review also identified a
choice-restoration window before the asynchronous native details toggle.
The source follow-up captures the user's next choice synchronously on the
summary click. Native validation now uses actual summary clicks to open and
close groups, including a redraw after closing. This follow-up is not part of
the immutable 2.34.2 bundle and needs a later release and production check.

Retained follow-up run `native-5` passed 26 of 27 checks, including both new
summary-click checks and clean final adoption. Its update-count check failed:
77 deltas produced 66 updates while only 20 animation frames were sampled.
The lab was mostly in the background; timer throttling is a possible cause,
not a verified diagnosis. The prior `native-3` run passed that check. Do not
use `native-5` as proof that the dense-stream timing check passed. The follow-up
build and all 906 JavaScript plus 11 Python tests passed.
