# battle render allocation profile

use chromium's allocation instrumentation to check the whole battle render
path after changing scene, transport, interpolation, projectile, or visual-pool
code:

1. start the complete network game with `bun run dev:all`, then join `/battle`.
2. open devtools → **memory** → **allocation instrumentation on timeline**.
3. start recording, play a full match, and stop after the results screen.
4. select a steady-state section after all ships and pools have been created.
5. filter the constructor list for `array`, `set`, `map`, `vector3`,
   `quaternion`, `color`, `object`, and `interpolated`.
6. expand retaining stacks rooted in `battle-visuals`, `renderremotes`,
   `renderworld`, or `projectilefield.step`.

the steady-state section passes when those render stacks have zero allocation
bars. network callbacks may allocate while replacing a frame view, and joining,
leaving, events, pool construction, and hud publication are deliberately outside
the steady-state render budget. save the recording from the memory panel and
attach it to the change when a regression is being investigated.
