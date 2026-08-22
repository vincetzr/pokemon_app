extends Node
## Autoloaded signal bus. Keeps the HUD, audio-less feedback and match state
## decoupled from whoever caused the event.

signal shot_fired(position: Vector3, weapon_id: String)
signal impact(position: Vector3, normal: Vector3, hit_character: bool)
signal player_hurt(amount: float)
signal kill(killer: String, victim: String, alive_left: int)
signal zone_phase(phase: int, radius: float, seconds_until_shrink: float)
signal match_over(won: bool, placement: int, kills: int)
