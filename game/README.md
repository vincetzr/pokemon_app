# Dropzone — battle royale vertical slice

A playable battle-royale core loop in Godot 4.3: land empty-handed, loot a gun,
survive a shrinking zone, be the last of ten standing.

```bash
# play the prebuilt web version — no engine install needed
cd game/build && python3 -m http.server 8000
# then open http://localhost:8000
```

```bash
# or open the project in Godot 4.3 and press F5
```

## Controls

| | |
|---|---|
| `W A S D` | move |
| `Shift` | sprint |
| `Ctrl` / `C` | crouch (tighter spread) |
| `Space` | jump |
| Mouse | look · **Left click** fire |
| `R` | reload · restart after a match ends |
| `Esc` | release the mouse |

## What is implemented

- **Procedural island**, 420 m across, regenerated from a seed each match:
  heightmapped terrain with height/slope-banded colouring, a coastline, 14
  compounds, treelines and rock cover.
- **Shrinking zone** in six phases, each with its own hold, shrink duration and
  damage rate. The next circle is placed inside the current one so running is
  always survivable. This is the mechanic that stops a match from stalling.
- **Five weapons** (`data/weapons.json`) with distinct damage, RPM, magazine,
  spread, range and pellet count, plus distance falloff. Player and bots fire
  through *the same* hitscan path, so nobody gets special rules.
- **Nine bots** with a four-state machine — roam, loot, engage, flee-the-zone —
  line-of-sight checks, a vision cone, range-keeping strafe, and a skill value
  that scales their accuracy. They loot and kill each other without you.
- **Loot** on the ground: weapons, ammo, medkits. Everyone lands with fists.
- **HUD**: health, weapon and ammo, alive count, zone phase timer, kill feed,
  hitmarkers, damage flash, and a crosshair that opens with movement.

## Layout

```
game/
  scripts/
    main.gd         match controller: spawns, zone damage, win/lose
    world.gd        procedural terrain, compounds, props, spawn selection
    player.gd       first-person controller
    bot.gd          AI opponent state machine
    arsenal.gd      weapon defs + shared hitscan resolution
    zone.gd         shrinking play area
    loot.gd         ground pickups
    hud.gd          all UI, built in code
    game_events.gd  autoloaded signal bus
  data/weapons.json balance lives here, not in code
```

Balance is data, not code — retuning a gun means editing `weapons.json`.

## Known gaps

- **Single-player only.** No networking yet; the lobby is filled by bots.
- Bots navigate by direct steering with a stuck-detector, not a navmesh, so they
  occasionally scrape along a wall before routing around it.
- No sound, no animation, no reload/recoil weapon models — the guns are stats
  and hitscans, not visible objects.
- Ridge tops read pale where the rock band meets strong sunlight.
- `build/` is committed so the game is playable without installing Godot. If
  this becomes noisy, move it to a CI artifact.
