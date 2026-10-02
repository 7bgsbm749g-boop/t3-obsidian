# Async answers and response completion

T3 sends non-blocking question answers as `async-answer:<requestId>` user
messages. That message can steer a running turn or start a new turn after the
question's source turn completes. Steering retains the original turn's
`requestedAt`, and the answer message can have a null `turnId`.

The response writer first uses the exact message's ordinary turn binding. If
there is no new-turn binding, it recognizes completed steering when the exact
answer's timestamp falls strictly between the source turn's request and
completion timestamps. The completion timestamp comes from that turn or its
real completion checkpoint. For older turns without a request timestamp,
finalized source-turn prose must bracket the answer in both transcript and
timestamp order. The proven source-turn binding is
saved with the question follow record, including when repairing an older
record that remained running after completion.

Answers submitted after source completion, missing lifecycle evidence, and
unrelated turns do not establish this binding. The writer
keeps its protection against premature completion while an accepted late
answer's exact follow-up turn is being projected. Native blocking questions
and dismissals retain their existing behavior.

Regression coverage exercises hosted v1 and v2 writers, device-local jobs,
restart recovery, source checkpoints while unrelated work runs, answer quote
ordering, removal of Working/spinners/tracking markers, and the late-answer
projection gap.
