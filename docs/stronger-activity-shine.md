# Stronger activity text shine

Active titles and response labels draw their text from a solid layer in the
label's existing colour, with a moving highlight above it. The foreground text
fill is transparent while the effect runs, so it no longer covers most of the
highlight. Dark-theme highlights mix in 75% white, or 100% for selected titles.
Light-theme highlights use 40% and 55%, respectively.

The highlight keeps the existing 4.5 rem width and 2.2 second duration. Fonts,
text layout, the circle's brightness and timing, and the hidden/offscreen pause
behaviour retain their existing rules. Reduced motion and forced colours use
ordinary text. A CSS feature check leaves ordinary text visible when gradient
text or colour mixing is unavailable.

## Verification

Run `npm run build` and `npm test`. Check real text painting in both themes,
including selected and unselected titles, response headings and activity rows.
Compare frames with the highlight outside and inside the label, and verify
that normal colours and font metrics are retained between passes. Check that
reduced motion shows ordinary text and that completion removes the effect.

The release also requires a real QLO2 client reload, a visible text-shine check,
temporary-note cleanup, and immutable smoke evidence. Browser and VPS desktop
checks do not establish native iPhone rendering. The reported phone was running
iOS 26.6.2 with Reduce Motion off and a moving circle; that report establishes
that its animation was active, but does not establish the original drawing
fault's exact cause.
