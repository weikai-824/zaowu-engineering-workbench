# Final Showcase exterior concept selection

Date: 2026-09-16

## Acceptance gate

The Rev17 enclosure and the selected replacement must read as different product generations from a one-second, pure-black silhouette comparison. Parameter tweaks, extra openings, and larger radii do not satisfy this gate.

## Candidate A — Quiet wedge

- Side silhouette: single rising roof line, low front and high rear.
- Front hierarchy: inset dark glass strip on the first half of the roof.
- Part split: shell / glass panel / rear vent deck / recessed plinth.
- FDM: lowest risk; every component can be printed on a broad face.
- Weakness: recognizable posture, but the uninterrupted wedge can still feel generic.

## Candidate B — Floating visor wedge (selected)

- Side silhouette: low nose, rising instrument deck, clipped rear shoulder, and a visibly recessed plinth.
- Front hierarchy: a dark, slightly proud visor spans the sloped front deck; sensor aperture is integrated into that visual centre.
- Part split: warm-white structural shell, dark visor, graphite rear service/vent cover, narrow shadow plinth.
- FDM: four broad, support-light parts; the sloped decks are generated as exact prismatic profiles rather than display-only mesh deformation.
- Strength: both the upper contour and the underbody shadow line differ from Rev17, so the silhouette survives the black-fill test.

## Candidate C — Soft saddle

- Side silhouette: concave waist followed by a convex rear crown.
- Front hierarchy: screen sits in a continuous compound surface.
- Part split: possible in four pieces, but clean curvature needs loft/sweep and more selective surfacing support.
- FDM: likely printable, but executor and kernel risk are materially higher in this iteration.
- Decision: rejected for this release; approximating it with many facets would add features without producing mature curvature.

## Executor decision

Add only:

1. `profile_extrude`: a bounded, closed 2D polygon extruded normal to XY/XZ/YZ.
2. `fillet_edges`: a radius applied only to edges parallel to X/Y/Z.

No loft, sweep, free-form script, or arbitrary selector string is added. This is the smallest vocabulary that can produce the selected wedge posture, recessed base, sloped visor/rear deck, and consistent long-edge radii while keeping deterministic validation and the 32-feature budget.
