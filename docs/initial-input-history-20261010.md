# Initial input placement

Initial questions and continuation prompts now use the same display placement
as steering. In Collapse mode, the input quote is the first item inside the
shared progress callout, from initial submission through streaming, recovery,
and completion. The current final answer remains below the completed fold.
In Keep and Remove modes, the input follows the active status header and stays
before the assistant transcript. Completed input quotes remain visible.

The renderer uses the existing initial-input record. It does not classify
prompts by words such as `continue`, convert primary inputs into steering,
change turn bindings, or move text in the user's saved note. Existing completed
Markdown is not rewritten. Exact prompt evidence, selection receipts, response
anchors, checked final saves, and Sync ownership remain unchanged.

Regression coverage checks the initial submission, each active or terminal
phase, formatted and raw final answers, unfinished input fences, input order
with later steering, final-answer placement, status discovery, and the existing
hosted input recovery across writer restarts.

Release verification must reload the real QLO2 client, verify the nested input
in Live Preview and Reading view, and check expanded and collapsed history.
Keep evidence outside the vault and preserve the user's current note and
settings. VPS desktop evidence does not establish native mobile coverage.
