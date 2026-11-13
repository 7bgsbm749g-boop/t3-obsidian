# Response design comparison images

These public images contain synthetic replay data only. The plugin screenshots
were captured in native desktop Obsidian 1.15.0, in separate unsynced validation
vaults. Before and after use the same fixtures and 1032 × 804 viewport, except
the explicitly labelled 430 px desktop check. The before renderer is main
`068f24c` (0.0.440); the after renderer is the PR candidate merged with that
base. Its ordinary source version remains 0.0.440.

The figures crop original PNG captures and add outlines, numbers and explanatory
labels. They do not redraw application content. Original captures, source hashes,
native results and fixture cleanup records remain in the external evidence store.
The replay dispatches no real T3 work or approval decisions. It does not prove
native mobile behavior.

| Image | Changed behavior |
| --- | --- |
| [Thoughts](01-thoughts.png) | Count labels, per-thought public summaries, short rows and long-trace expansion |
| [Activity and tools](02-activity-tools.png) | Clickable public preview, action/source icons, linked thread titles, flat tools without outputs |
| [Tasks and compaction](03-tasks-compaction.png) | Running task state, timeline order, token counts and elapsed compaction time |
| [Timing](04-timing.png) | Readable work durations and separate continuation segments |
| [Approvals](05-approvals.png) | Request kinds and provider-supplied decision options |
| [Questions](06-questions.png) | Progress, navigation, numbered choices and single-select advancement |
| [Narrow questions](07-narrow-questions.png) | Navigation wrapping in a narrow desktop window |
| [Plans](08-plans.png) | Proposed-plan Markdown, preview and expansion, separate from Tasks |
| [Existing mixed summaries](09-existing-mixed.png) | Comparison only; mixed-summary policy remains unchanged |

The mixed-summary figure contains two source-renderer screenshots, not a live
T3 run. Its T3 renderer and summary algorithm come from upstream `t3code`
`fdcf27211e5d8d42568b92a55024e7111b6620fe`; its plugin comparison uses the
original 0.0.425 audit renderer, whose mixed-summary policy remains unchanged.
The native replay uses these source-produced artifacts without redrawing them.
