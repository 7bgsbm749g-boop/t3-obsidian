# Memory recovery for releases

A temporary admission refusal must retain an automatic continuation. It is not
a test failure and does not consume the three-attempt failure allowance, revert
reviewed source, discard an archive, or remove the evidence requirement.

The queue probes the installed resource manager without allocating the requested
memory. Delays are 30 seconds, then 1, 2, 4, 8 and 15 minutes, capped at 15
minutes. Each failed probe and its next deadline are stored in the job. A
persistent one-shot systemd timer wakes the worker at the earliest deadline.
Worker restarts and submissions from other threads do not reset the delay or
probe early. An unavailable probe is a denial, never permission to publish.

Known admission failures inside the worker enter `waiting-for-memory`
automatically. Once admission passes, the worker resumes its saved candidate and
uses the same immutable archive if packaging already completed. An integrated
candidate retains the installation lane. An unintegrated verification wait
does not prevent later independent releases.

## Native verification before publication

The queue cannot perform an agent's interactive verification by itself. When
that verification is refused by memory admission:

1. Commit the reviewed source and enqueue it with its native `--thread-id` and
   `--summary`. Wait for `needs-evidence`; a product job without evidence stops
   there before integration. Registration refuses a still-runnable job so it
   cannot race the worker.
2. Use native T3 `schedule_task` to create an enabled interval recovery watch,
   bound to this same thread, initially every 30 seconds. Give it a title
   containing the job ID and a stable `clientRequestId` for registration retries.
3. Pass the returned `scheduledTaskId` and the refused memory allowance to:

   ```sh
   npm run release:qlo2 -- --wait-for-memory JOB_ID --memory-budget 768M --resume-task-id SCHEDULED_TASK_ID
   ```

   The CLI requires both a native owner thread on the request and its recovery
   watch ID. Do not leave a memory-blocked job in plain `needs-evidence` and end
   the turn without this continuation. Report the watch cadence and next run
   returned by T3.

The watch prompt must identify its exact job and carry these instructions:

> Read only this release job with `--probe-memory JOB_ID`. If it is still waiting
> for memory, update this native schedule to
> `memoryWait.nextProbeDelaySeconds * 1000` milliseconds. If admission has passed,
> resume the original authorized verification, fixture cleanup and QLO2 delivery
> from its committed source. Preserve the required checks and real smoke evidence.
> If this thread is already testing the job, continue that test; do not start a
> duplicate or stop it. Keep the watch until the job completes, permanently
> fails, or the user cancels. If the queue is already publishing or finalizing, monitor delivery
> without repeating verification; use a bounded watch interval. On completion,
> delete the native schedule using `recoveryTaskId` from
> the job state. On permanent failure or cancellation, report the state and
> delete the watch instead of treating it as a memory refusal.

The probe command is idempotent before its deadline. It does not contact the
resource manager early or reset the backoff when another release wakes the
worker. Once memory is ready, verification jobs return to `needs-evidence` with
`memoryWait.ready=true`; their native watch resumes the agent automatically.
The queue still requires the resulting evidence and cleanup proof before
publication. A probe does not reserve memory: if the actual launch is refused
again, re-arm `--wait-for-memory` with the same watch; its delay is retained.

The owner supplies the new evidence through the existing reviewed replacement:

```sh
npm run release:qlo2 -- --retry-queued JOB_ID --replacement HEAD --thread-id THREAD_ID --summary "CHANGE" --evidence PATH --notes "VERIFIED BEHAVIOR AND CLEANUP"
```

Explicit code/test failures, merge conflicts and V8 heap configuration errors
remain ordinary failures. Their recovery is not a memory-admission probe loop.
