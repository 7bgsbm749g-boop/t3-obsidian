# Cursor placement for note sends

Manual note sends capture the active editor cursor when Send is activated,
before project lookup, thread checks, image preparation, or the destination
chooser. A reply starts at that position when it is between Markdown blocks.
If the cursor is inside a paragraph, the reply follows the complete paragraph,
including soft-wrapped source lines. Lists, block quotes, tables, code blocks,
frontmatter, and retained response boundaries stay intact. Replies have blank
lines on both sides so raw final answers remain separate Markdown blocks.

The chooser's default, New thread, and Existing thread actions retain the same
captured position. Moving the cursor while preparation is pending does not
move the response. Unrelated note edits can map the captured position; changes
at the insertion boundary stop the send and ask the user to send again.

Whole-note sends map displayed offsets through the native response projection
to the saved note. Streamed output and compact tool summaries before the cursor
cannot shift insertion into another paragraph or a response container. A cursor
inside a response maps after that response. Running-thread steering still uses
the existing response identity and does not create a second response block.

Ask without a selection uses the captured cursor too. Import T3 run captures
the same saved cursor when the import picker opens, before selecting a project,
thread, or run. Completed imports and running imports use the same block rules;
duplicate imports remain idempotent. Following future runs retains the existing
stream registration behavior. Selection questions keep their existing placement
below the selection. Sends and imports without an active editing cursor, agent
commands, and separate destination notes retain end-of-note placement. An
explicit destination section takes precedence over the cursor hint. Cursor hints are transient preparation
data; response requests and saved binding formats are unchanged.

Regression tests cover paragraph and block boundaries, note properties, code
fences, response markers, conservative edit mapping, native block spacing,
replay, explicit sections, asynchronous Send routing, reading-view sends,
projection offsets, and Ask reservation. Native mobile UI is not covered by
the VPS desktop smoke test.
