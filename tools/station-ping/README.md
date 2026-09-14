# Late-marker ping study

Serve the repository and visit `/tools/station-ping/` (any `station*` launch
config works; the page is static).

A board of the run-down timeline's late markers - a hopper past its pump-off
point with the pump still running, parked on the Now line - pinging four ways
(radar, double ring, sonar, halo) at three intensities (whisper, standard,
insistent), under any of the six themes. Every cell is the real
`rundown.css` markup; `preview.css` holds the two CANDIDATE blocks (the hit
target and the ping) written the way they would ship.

Controls: theme, ring colour (danger or the layer's accent), scene (one late,
two stacked at the same instant, three across three lanes), a forced hover
ring on the first dot, an outline of the hit targets, and motion off (which is
also what `prefers-reduced-motion: reduce` gets: one still ring).

## Chosen (2026-09-13)

**Sonar, insistent**: one 1.5 px ring out 13 px past the dot's edge, the dot
brightening as it leaves, every 1.5 s, in the danger colour. Shipped in
`station/styles/components/rundown.css` under "Late, and saying so"; the hit
target shipped with it.
