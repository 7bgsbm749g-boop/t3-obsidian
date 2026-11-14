# Editing conversation history


Changing a saved note does not change T3 conversation history. The current
Orchestrator v2 command contract supports editing queued runs, checkpoint
rollback, and thread forks. It has no client command to replace completed user
or assistant messages and reconstruct the provider's history. `message.updated`
is an event, not an authorized client editing command.

A history editor would need a T3 feature that defines the edited transcript,
invalidates affected checkpoints and tool results, and rebuilds or forks the
provider session. The plugin must not claim to edit history by changing only
the displayed note. Fork and rollback remain distinct operations; this change
does not invoke either automatically.
