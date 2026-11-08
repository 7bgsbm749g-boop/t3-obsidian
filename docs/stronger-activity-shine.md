# Stronger activity text shine

Active titles and response labels use the existing text-shine painting method.
The moving gradient now has a white core from 40% to 60% of its width, instead
of a single peak mixed with the text colour. This strengthens the highlight
without replacing the ordinary text fill. The foreground transparency is
50% in dark themes and 12% in light themes, or 50% and 26% for selected titles.
Dark-theme activity labels and unselected titles now use the same 50% strength
as selected titles, increased from 24%.

The highlight keeps the existing 4.5 rem width and 2.2 second duration. Fonts,
text layout, circle timing, and the hidden/offscreen pause behaviour retain
their existing rules. Circle highlights inherit 18% of the text-shine strength,
so their default dark-theme white mix also increases from 4.32% to 9%; their
overall opacity remains 72%. Reduced motion and forced colours use
ordinary text. A CSS feature check leaves ordinary text visible when gradient
text or colour mixing is unavailable.

## Verification

Run `npm run build` and `npm test`. Check real text painting in both themes,
including selected and unselected titles, response headings and activity rows.
Compare before-and-after screenshots in the same document and coordinates,
including frames with the highlight outside the label. The strength parameter
also controls foreground transparency, so record any glyph-edge differences
between passes rather than assuming that ordinary dark text is pixel-identical.
Check selected, unselected and custom-coloured labels in both themes. Compare
highlight frames separately to verify increased brightness. Check that
reduced motion shows ordinary text and that completion removes the effect.

The release also requires a real QLO2 client reload and immutable smoke evidence.
QLO2 checks use existing content only; synthetic display fixtures belong in a
separate test vault and must be removed after use. Record test-vault checks
separately. Browser and VPS desktop checks do not establish native iPhone
rendering. The reported phone was running
iOS 26.6.2 with Reduce Motion off and a moving circle; that report establishes
that its animation was active, but does not establish the original drawing
fault's exact cause.

## Regression cause

The 2.45.9 change replaced the foreground text fill with full transparency and
used a clipped background to draw all letters. That can change antialiasing and
apparent weight. Matching font properties, colour and dimensions did not prove
that the text looked the same. The previous checks measured animation contrast,
but omitted a rendered comparison against the accepted version. The assurance
that normal text was unchanged therefore exceeded the evidence.

The repository's visual-change guidance now requires both the unchanged-text
comparison and the intended-effect check, and limits platform claims to the
clients actually tested.
