# Crash Velocity

A Burnout-inspired 3D arcade racer built with **Next.js 16**, **React Three Fiber**, and
**Rapier** physics. Pick a ship in the hangar, then race one of three tracks.

## Run locally

```bash
npm install
npm run dev      # http://localhost:9002
```

> **GitHub Packages dependency.** This project depends on
> [`@tuomashatakka/threejs-scenes`](https://github.com/tuomashatakka/threejs-scenes-skill),
> published to **GitHub Packages** (`npm.pkg.github.com`). Installing it requires a token —
> see [Deploying](#deploying). Locally, a `~/.npmrc` with a `read:packages` token for the
> `@tuomashatakka` scope is enough.

## Controls

| Input | Action |
| --- | --- |
| `←` `→` / `A` `D` | Steer (and steer the nose mid-jump — *aftertouch*) |
| `Shift` (hold) | Boost — extra thrust + higher top speed while the reserve lasts |
| `R` | Respawn at the last checkpoint |

## Race rules

- A **3-2-1 countdown** gates the throttle; you launch on **GO!**.
- **Loop tracks** (Neon Canyon, Orbital Ring) are **3 laps** — cross the checkpoints in order;
  the start/finish line closes each lap. **Origin Circuit** is a single **sprint** to the finish.
- Falling off, flipping over, or pressing `R` respawns you at the last cleared checkpoint.
- Hard impacts shake the camera and flash the screen.
- Lap / total / best times show in the HUD; the finish screen has a **Race Again** button.

## Tracks

- **Origin Circuit** — branching procedural sprint with a shortcut jump.
- **Neon Canyon** — banked, winding ravine loop.
- **Orbital Ring** — banked figure-eight station suspended in the starfield.

## Deploying

The build runs `npm ci`, which must authenticate to GitHub Packages for the
`@tuomashatakka/threejs-scenes` dependency.

1. The repo ships a committed `.npmrc` that maps the scope and reads the token from an env var:
   ```
   @tuomashatakka:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```
2. In your host's environment variables (Vercel → Project → Settings → Environment Variables,
   for **Production**, **Preview**, and **Development**), set:
   - `NODE_AUTH_TOKEN` = a GitHub Personal Access Token with the **`read:packages`** scope.

Without `NODE_AUTH_TOKEN`, the install step fails with `401 Unauthorized` from
`npm.pkg.github.com`. **Never commit the literal token** — only the `${NODE_AUTH_TOKEN}`
reference belongs in the repo.
