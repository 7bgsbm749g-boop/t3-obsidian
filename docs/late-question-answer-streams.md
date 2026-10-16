# Late question answer streams

Local final delivery replaces a response container with ordinary Markdown and
stops its preview. A nonblocking question can remain pending after that save.
Previously, submitting its answer sent the command to T3 but did not attach
another editor response. The retired writer could keep the old container open;
the local final-save path deliberately cannot reopen saved replies.

Message-mode submissions now retain the question, answer command and source
note path before dispatch. An acknowledgement or canonical resolution makes
this intent eligible for stream recovery. The handler reads the exact
`async-answer:REQUEST_ID` message. Canonical run ownership takes precedence;
source completion timestamps distinguish an unbound late answer from steering
inside the original run. A missing answer or uncertain source lifecycle waits
for projection and cannot adopt the thread's unrelated latest run.

A late answer gets a separate local response container, with a deterministic
identity for its environment, thread, question and note. It inherits the
original response's display preferences. Its initial input is the submitted
answer disclosure, including the original questions. The new final save
replaces only this new container. The original reply and ordinary note edits
remain in place. An answer inside the source run uses the existing stream;
native blocking answers and dismissals do not create continuation intents.

The accepted intent survives a lost acknowledgement, missing projection,
failed registration and reload. Recovery only attaches a reader; it never
dispatches another answer. Existing bindings prevent duplicate or resurrected
completed streams. An exact generated question can locate a renamed origin.
Editor widgets capture their own note path, including in an inactive pane;
Reading view uses its renderer's source path. Recovery data stays in the
existing device-local question store, while response routing uses the existing
synced binding store.

Local source previews do not follow a late answer into another run while the
old final save waits for Sync. The legacy writer retains its existing follow
behavior. Regression checks cover local final saves, canonical ownership,
unrelated runs, duplicate attempts, missing projection, reload, lost
acknowledgements, registration failure, origin rename, and native/dismiss paths.

A release requires a real QLO2 late-answer delivery and immutable smoke
evidence in addition to the build and complete automated suite. Desktop
verification does not establish native mobile behavior.
