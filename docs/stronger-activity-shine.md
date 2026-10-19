# Stronger activity text shine

Active titles and response labels retain the foreground text fill from 2.45.8.
The moving gradient now has a white core from 40% to 60% of its width, instead
of a single peak mixed with the text colour. This strengthens the highlight
without changing the paint between passes. The foreground transparency remains
24% in dark themes and 12% in light themes, or 50% and 26% for selected titles.

The highlight keeps the existing 4.5 rem width and 2.2 second duration. Fonts,
text layout, the circle's brightness and timing, and the hidden/offscreen pause
behaviour retain their existing rules. Reduced motion and forced colours use
ordinary text. A CSS feature check leaves ordinary text visible when gradient
text or colour mixing is unavailable.

## Verification

Run `npm run build` and `npm test`. Check real text painting in both themes,
including selected and unselected titles, response headings and activity rows.
Compare screenshots against 2.45.8 in the same document and coordinates, with
the highlight outside the label; unchanged text must have identical pixels.
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
