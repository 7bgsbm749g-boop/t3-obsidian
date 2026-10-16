# Submitted answers in the editor stream

Resolved T3 questions now use the same native disclosure behavior as tool
groups. A closed row shows **User input submitted**, an answer preview, and a
UTC submission time when available. Opening it shows each original question
with its full answer. Long previews are shortened; expanded answers retain
their complete text, line breaks, and selected values. HTML is escaped.

Both native and message-mode answers use this display in Remove, Keep, and
Collapse history modes. The answer stays between its frozen preceding prose
and subsequent assistant text. In Collapse mode it stays inside the history
fold while the completed final answer remains outside. Initial prompts and
ordinary steering retain their existing callouts.

Question definitions are retained when the request arrives, before activity
history can be truncated. Each submitted input stores the request identity,
questions, answer values, and submission time in its existing checkpoint.
Recovery does not require another response or another provider turn. When old
records have no question definition, the disclosure shows the saved answer.
Canonical async-answer messages cannot duplicate or obscure the answer row.

The existing native disclosure presentation retains answer nodes and user
expansion choices across editor replacements, using a separate answer identity.
No network request is required to expand an answer. Canonical message text,
execution bindings, selection receipts, and tool-output references are unchanged.

Automated checks cover both response modes, all history modes, conversation
order, checkpoint recovery before and after submission, duplicate canonical
messages, multiple questions, custom multiline text, long answers, HTML,
legacy records, dismissal, and unrelated turns. A DirectInlinePreview test
feeds native request and resolution events, then verifies the answer row
through subsequent text updates.

The QLO2 release requires a separate real-client reload and editor smoke.
Its immutable completion receipt records the delivered version and evidence.
Desktop smoke does not establish native iPhone or Android UI behavior.
