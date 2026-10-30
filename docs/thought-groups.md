# Thoughts and tools in one activity batch

Public reasoning summaries and tool calls now share one default-closed activity
batch. Expanding it shows each Thought and each tool call at the same depth,
in chronological order. A summary such as `Ran 2 commands · 3 thoughts` replaces
the alternating top-level Thought and tool dropdowns.

Assistant commentary, user input, plans, notices, context compaction, HTML
results and run changes end a batch. Canonical ordinals resolve tied timestamps.
The earliest canonical identity keeps the batch stable as summaries stream or
concurrent tool results arrive. Each thought retains formatted public content,
a brain icon and a client-local timestamp. Each pane retains its own batch and
nested disclosure choices. Old saved native Thought callouts remain supported.

Thoughts are display data. They cannot establish run completion or replace
verified final-answer delivery. The completed final answer stays outside the
closed history, and the remove-intermediate preference still removes completed
activity. Live projections do not write generated content into saved note text.

The compact presentation stores the exact canonical batch behind its summary.
Thought-only and mixed batches use the same lazy expansion, offset mapping and
save protection as tool-only batches. Markdown formatting uses micromark's
safe defaults, with literal HTML and unsafe URLs escaped.

Regression tests cover alternating entries, stable identity, streamed summary
replacement, tied timestamps, public-content boundaries, final-answer placement,
Stop and exact restoration of formatted thought and tool content.

Run the native replay in a new directory under this project's ignored
`evidence/` directory:

```sh
node scripts/build-native-response-lab.mjs evidence/NEW-TASK/native-1 --thoughts
```

The isolated replay checks Live Preview and Reading view in a real VPS desktop
Obsidian client. It dispatches no T3 work and removes its fixture notes through
Obsidian's vault API. Keep results, screenshots, source hashes and `CLEANUP.json`
in that evidence directory. No test content may be created in QLO2. These checks
do not establish native iPhone or Android behavior. QLO2 delivery still requires
the release queue, fresh Sync and the real loaded-client check.

Native replay `evidence/thought-tool-batches/native-4` passed all ten checks.
Its `BUILD-SOURCE.json` matches the checked runtime inputs, and `CLEANUP.json`
records no remaining notes or temporary threads. Open batches refresh their lazy
content when its reference changes; unchanged references retain loaded details.
