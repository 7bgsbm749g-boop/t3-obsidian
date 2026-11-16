# Send composer

The note Send destination dialog and Ask agent box share one composer. The note
or highlighted passage stays captured as context while you choose a project,
model, and destination.

- Leave the question empty to send the captured note or selection.
- Type a question to ask about that context.
- Use the streaming switch to control replies in the editor for this send.
- Switch the final answer between Quoted Markdown and Raw Markdown. The
  format switch is disabled while editor streaming is off.
- The model button reads the chosen machine's provider catalog and advertised
  model options. Changes apply to this send. They do not change global settings.

The thread dropdown sits beside the arrow send button. It starts at New thread.
Choose Existing thread to open the thread picker. Selecting a thread changes the
composer's destination; it does not send. Previous thread is also available for
notes with a remembered destination. Linked notes in 1:1 mode and active-response
continuations keep their required thread.

Click the arrow or press Enter to submit. Shift+Enter adds a line. Closing a
picker keeps the draft. Changing projects clears the old thread and model choice.
The composer retains its draft and switches after a recoverable send failure.

Confirmed quick sends and command-palette submissions still use their captured
default route. Holding the destination-selection modifier, using the explicit
choose-destination command, or opening Ask agent shows the composer. A first send
also opens it. Progress and final-answer presentation in an already running
response keep that response's existing policy.
