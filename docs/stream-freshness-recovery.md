# Recovery from a stalled response feed

An owning response writer checks T3's canonical snapshot when it has not
accepted a snapshot for ten seconds. The check runs from the same coordination
tick as lease renewal. On desktop that tick uses Node timers, so background
renderer throttling cannot keep ownership alive while indefinitely postponing
response recovery. Stream events do not postpone the snapshot deadline.

Each response has at most one current snapshot request. Initial reads,
periodic recovery and final completion validation share it. Snapshot sequence
checks preserve newer stream state. Ownership epochs, stop requests and
disposal fence late results. A request that hangs for thirty seconds is
expired by coordination ticks; failures retry after five seconds, doubling
up to thirty seconds. Failed reads never manufacture completion.

The check updates the stream cache and schedules the ordinary writer. Existing
exact-message and question-turn bindings, save verification, completion proof
cleanup and lease protections still decide whether it can finalize. A quiet
healthy response is checked at most once per ten seconds; accepted stream
snapshots avoid redundant recovery reads.

Regression tests cover a stale running cache with no incoming events,
outage retry, a hung request and its late result, sequence and ownership
races, and completion with all renderer timers suspended in the desktop
bundle.
