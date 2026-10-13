# Activity shine and circle — QLO2 2.37.25

Active file names, ancestor folder names and tab titles keep their original
fonts, sizes, weights, spacing and colours. Existing stream headers, activity
labels, tool summaries and context compaction also receive text shine. Selected
titles have a stronger shine than unselected titles. Hidden and offscreen labels
pause; reduced-motion and forced-colour preferences keep ordinary text.

Only file, folder and tab titles and the top stream header receive the circle.
Its SVG contains eight stationary rounded segments. A hard 45-degree mask
switches one whole segment off and the previous segment back on every step.
The circle is 0.75 em, capped at 10 px, with 0.72 opacity and a soft highlight.
It adds no Working label to navigation titles. Saved loading markers remain
available for Stop and recovery. Terminal context compaction does not keep
shining when its completion event is missing.

Reviewed implementation commits include `4f1021e`, `35c1ed5`, `f7bc1d4`,
`857dca6`, `7c66dce`, `93450d8` and `a3d628b`. The supported release command
packaged the clean source, installed both vaults while preserving their
settings files, and verified a fresh official Obsidian Sync scan. The build,
1,412 TypeScript tests and 14 Python tests passed. Release checks repeated them.

## Real client checks

The VPS QLO2 client loaded 2.37.25 through **Reload app without saving**.
Reading view and Live Preview checks recorded 9.75 px circles on file, folder
and tab titles, and 10 px circles on stream headers. Two native samples recorded
whole 45-degree steps; the computed timing function is `steps(1)`. Circle opacity
is 0.72. Thinking, tool and compaction rows have text shine without circles.
Thirteen native label comparisons matched the original font and colour
properties with the effect enabled and disabled.

A temporary mirror of the ongoing T3 turn supplied real navigation activity.
It was removed without cancelling that turn. Production-renderer Stop and
completion fixtures cleared all visible animation and circles. The completed
history closed and the final answer stayed outside it. Hidden preview caches
were excluded from the visible-surface check.

The temporary note, its empty folder and both temporary panes were removed.
All 46 original pane states and the original active note were restored. The
original note bytes were unchanged. CLI is disabled, Settings is closed, and
the global configuration is byte-identical to its preimage. Unrelated runtime
settings updates were preserved.

Native filesystem delays during setup required guarded recovery. This work
does not establish a fix for Obsidian's filesystem queue. Native phone and
Windows rendering were not tested; Mobile Tab Bar routing has unit coverage.

## Retained evidence

Evidence root:
`/home/ubuntu/backups/send-to-t3-code/activity-shine-20261012`.

Immutable smoke receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.37.25/smoke-vps-qlo2-circle.json`.

Archived evidence:
`/home/ubuntu/backups/send-to-t3-code/releases/2.37.25/smoke-vps-qlo2-circle-evidence.json`.
