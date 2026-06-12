# Day Game — preserved future theme (not built)

> Status: **documented only**. ADR-0012 chose Night Game as the single primary theme.
> This spec preserves the rejected daylight variant so a future theme (user-selectable
> or time-of-day aware — e.g. Day Game until sunset, Night Game after) is a token swap,
> not a redesign. Prototype reference: `docs/design/direction-protos-r3.html`, panel B.

## Identity

Same materials as Night Game — clay, chalk, varsity type, split-flap reveal — under
noon sunlight instead of dusk. Scrappy, sunlit, scorebook-adjacent.

## Token values (semantic name → Day Game value)

| Semantic token        | Day Game value      | Night Game equivalent (for contrast) |
| --------------------- | ------------------- | ------------------------------------ |
| canvas                | `#f4ead8` cream     | `#131736 → #0c0f20` gradient         |
| surface (tiles, keys) | `#fffdf7` chalk-white | `#1c2230`                          |
| surface border        | `#e2d5bd`           | `#343c66`                            |
| ink / primary text    | `#3a3329`           | `#f5f1e6` chalk                      |
| muted text            | `#8c7f6a`           | `#8d94b8`                            |
| action / lock         | `#c2502a` clay (shadow `#8f3a1e`) | amber `#ffb454` (shadow `#c98a3a`) |
| consequence / outcome | `#a3242e` stitch red | `#ffb454` amber                     |
| field lines           | `#3a3329` ink       | `#f5f1e6` chalk                      |
| field fill            | `rgba(93,122,78,.12)` grass tint | `rgba(245,241,230,.04)`  |
| good-outcome ladder   | `#5d7a4e` grass on chalk | amber text on surface           |
| runner (batter)       | `#c2502a` clay, chalk outline | amber, glow                 |
| runner (lead)         | `#1c2230` ink, chalk outline | clay, glow                   |

## Motion differences

- Outcome resolves with a **rubber-stamp** (rotate −12° → −3°, scale 1.9 → 1) in
  stitch red, instead of Night Game's bulb-glow bloom.
- Runner tokens read by outline contrast, not glow — no `box-shadow` light effects in
  daylight.
- Split-flap reveal and field-diagram choreography are identical in both themes.

## Implementation note (when built)

Expose as a `data-theme="day"` scope that reassigns the semantic `@theme` variables;
no component changes should be required if components consume only semantic tokens.
The reveal's *glow* treatments must key off a token (e.g. `--shadow-consequence`),
not hardcoded shadows, so daylight can zero them out.
