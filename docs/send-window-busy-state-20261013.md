# Send window busy state

The reported iPhone screen showed a disabled New thread action. A synthetic
mobile-bundle reproduction found a stale busy value in the full-note window:
`openNoteSend` copied the plugin's busy boolean into its host. After the plugin
finished the earlier send, the window still retained `true`, rejected taps,
and displayed no explanation. A newly opened window used the current value.

Send hosts now read the current busy value and subscribe to its changes.
Whole-note, selection, and composer windows disable their project, override,
and destination controls while another send is in progress. A visible status
explains the wait. Completion updates those controls in place. This does not
redraw the draft, change its project or overrides, restart its conversation
check, or enable an unavailable previous thread. An in-progress selection of
a destination stays disabled until that submission finishes.

Subscriptions are replaced on redraw and removed when the window closes.
Regression coverage exercises busy transitions, pending submission, an
unavailable previous thread, draft retention, listener cleanup, and an actual
full-note dispatch through the mobile bundle after an earlier send completes.

Investigation also found the production QLO2 desktop client closed. The gym
note contained two empty failed-response boundaries with discard stop intents
at 18:52:14 and 18:53:03 UTC. The designated desktop client must be available
to register streamed replies before dispatch. Its absence is separate from
the window's stale busy value. The client was reopened without terminating
unrelated Obsidian windows. Previous failed attempts must be checked before
retrying the actual note, to avoid duplicate T3 work.

Bundle tests and desktop client verification do not establish native iPhone
behavior. Phone reload and interaction must be reported separately.
