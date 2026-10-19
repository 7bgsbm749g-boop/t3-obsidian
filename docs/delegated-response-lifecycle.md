# Replies that wait for delegated tasks

T3 can complete a parent app run while its delegated tasks are still running.
Each delivered child result can start another parent run. Previously, the
plugin dropped the delegation records and finalized the first completed run.
The note then missed the remaining progress and combined answer.

The response now retains T3's small delegation lifecycle records in its local
binding checkpoint. It follows exact automatic-message parent IDs, delivery
message IDs, and acknowledged observation run IDs. It does not follow a
thread's newest run merely because that run is active. A known independent
user prompt is excluded from the observation fallback.

An open delegation disposition alone does not mean the work is unfinished.
T3 keeps it after all children have been observed. A completed parent waits
while waking app-owned children are active, terminal results await observation,
or a delivery has not yet acquired its run. After a delivery, the same response
shows the resumed parent's output. A later delivery can return it to waiting.
Only the final parent result becomes eligible for the exact-item final check.
Live run-status updates can omit the delegation record. They must not clear
previously observed delegation metadata. An active waking app-owned child
also proves pending work before that source record is available. An explicit
closed disposition still ends the source's delegation lifecycle.

Between parent runs, the active block says **Waiting for subagents** and shows
the number still running. Its response anchor and subscription remain active.
The final combined parent reply uses the existing final-save path. Question
answers and steering retain their own exact bindings. Job observations also
wait for the delegated work before reporting the parent result.

The metadata contains no child prompts or reports. This change does not add
child stream viewing or allow the response binding to change threads. Those
features need a separate display controller and source validation. In
particular, viewing a child must not change the parent final save or acknowledge
the child's completion on behalf of the parent agent.

Regression checks cover multiple child deliveries, both message/run event
orders, terminal-before-acknowledgement gaps, checkpoint recovery, nested
delegation, unrelated runs, non-waking children, final-item verification, and
job completion. Behavioral validation must also retain a real test-vault
editor showing the waiting state and its later resumed final answer. QLO2
release checks create no test content and separately verify installation,
fresh Sync, and the loaded version after reload. Desktop evidence does not
establish native iPhone or Android behavior.
