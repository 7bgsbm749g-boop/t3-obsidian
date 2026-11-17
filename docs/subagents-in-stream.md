# Subagents in response streams

Subagent work and completion notices use the same compact timeline row in note
streams and sidebar conversations. Rows show a circular provider avatar, status
badge, title, progress or result preview, elapsed time, and a navigation chevron
when a child thread exists. Hover text includes model, effort, status and preview.
Colors and typography use Obsidian theme variables.

The presentation follows T3 Code's `V2LifecycleRow.tsx` (`SubagentTimelineLink`
and `SubagentNotificationLink`) and `SubagentTooltipContent.tsx`, inspected at
source commit `c52df24d28`. OpenAI and Claude provider glyphs come from that
version's `Icons.tsx` under its MIT license. The sidebar controller is shared
with the conversation views from PR #22.

Clicking a row reads the exact parent on its original T3 environment, checks the
task and owning run, then reads and opens the canonical child in a read-only
subagent sidebar tab. Linked-machine children open on their canonical machine.
Removed or changed tasks, unavailable connections and deleted threads fail with
an error. Opening a child sends no prompt and does not acknowledge a task result.
Rows without child threads remain visible without a link.

Subagent metadata comes from canonical subagent records and turn items. A
structured task notification uses the same row, with the notification's outcome
and time. Unknown notices keep their existing presentation; quoted notice prose
does not create navigation. Raw automatic delivery inputs are hidden only when
their task IDs have corresponding subagent rows. Execution bindings remain intact.

Checkpoints retain only bounded display metadata and a preview of at most 1,200
characters, never a full child prompt or report. Saved unfinished streams can
recover rows without inventing thread IDs. Already saved completed responses are
not rewritten. Active text and clocks update through the existing document
presentation hooks; rows add no polling or per-child stream connections.

Regression tests cover live/snapshot ordering, checkpoint recovery, output
escaping, unavailable children, parent/child identity checks, local and remote
sidebar routing, repeated clicks and listener cleanup. Native desktop/mobile
visual and interaction checks must be reported separately from these fixtures.
