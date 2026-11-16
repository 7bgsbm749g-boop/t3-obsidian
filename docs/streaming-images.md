# Images in streamed responses

Images opened with `view_image`, and images returned by completed tools, appear
at their tool's position in the progress stream. Click an image to open a larger
view. The completed progress fold retains its images. In the legacy keep/remove
presentation modes, images appear between response paragraphs and remain with
the final response, like HTML results.

The note stores a small `t3-image` code block with the source machine, thread,
run and tool item identity. It contains no image bytes, credentials or temporary
download URL. The native Markdown processor handles Live Preview and reading
view, including images inside progress callouts. Source mode shows the reference.

Before the first download on a device, the plugin verifies the canonical tool
item through T3 Connect, then requests an authenticated asset URL. Both tool
output image blocks and the exact file opened by `view_image` are supported.
PNG, JPEG, GIF and WebP images up to 10 MiB are accepted. Each tool can expose
up to eight output images. Unsupported image formats are not embedded.

Downloaded bytes are cached on that device, so a cached image can reopen offline.
The cache retains at most 64 images or 100 MiB and does not sync through the vault.
Another device needs its own working connection and sign-in for the first load.
An unavailable image displays an explanation and a retry button. Images are not
copied into vault attachment folders.

Live item events and snapshots use the same image references. Small references
survive partial reconnect snapshots and response recovery; complete canonical
snapshots can remove obsolete references. This does not add images retroactively
to response text that was already saved by an older plugin version.
