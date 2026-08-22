class_name Arsenal
extends RefCounted
## Weapon definitions loaded from data/weapons.json, plus the shared hitscan
## resolution both the player and the bots fire through — so a bot's rifle and
## your rifle obey exactly the same rules.

const DATA_PATH := "res://data/weapons.json"

static var _defs: Dictionary = {}

static func defs() -> Dictionary:
	if _defs.is_empty():
		var f := FileAccess.open(DATA_PATH, FileAccess.READ)
		if f == null:
			push_error("weapons.json missing")
			return {}
		var parsed = JSON.parse_string(f.get_as_text())
		if typeof(parsed) != TYPE_DICTIONARY:
			push_error("weapons.json malformed")
			return {}
		_defs = parsed
	return _defs

static func get_def(id: String) -> Dictionary:
	var d := defs()
	return d.get(id, d.get("fists", {}))

static func ids() -> Array:
	return defs().keys()

## Loot-table pick: better guns are rarer.
static func random_weapon_id(rng: RandomNumberGenerator) -> String:
	var table := [
		["smg", 32], ["rifle", 28], ["shotgun", 22], ["dmr", 18],
	]
	var total := 0
	for e in table:
		total += int(e[1])
	var roll := rng.randi_range(0, total - 1)
	for e in table:
		roll -= int(e[1])
		if roll < 0:
			return String(e[0])
	return "smg"

## Fires one shot and returns an array of hit dictionaries:
##   { "collider": Node, "position": Vector3, "damage": float }
## `shooter` is excluded from the trace so nobody shoots themselves.
static func fire(
	world: World3D, origin: Vector3, forward: Vector3, def: Dictionary,
	shooter: Node3D, rng: RandomNumberGenerator, accuracy_scale: float = 1.0
) -> Array:
	var results: Array = []
	var pellets := int(def.get("pellets", 1))
	var spread := float(def.get("spread", 0.02)) * accuracy_scale
	var range_m := float(def.get("range", 100.0))
	var dmg := float(def.get("damage", 10.0))
	var space := world.direct_space_state

	for i in pellets:
		# cone spread: perturb the forward vector on its own basis
		var basis := Basis()
		var up := Vector3.UP if absf(forward.dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
		var right := forward.cross(up).normalized()
		var real_up := right.cross(forward).normalized()
		var dir := (forward
			+ right * rng.randfn(0.0, spread)
			+ real_up * rng.randfn(0.0, spread)).normalized()

		var q := PhysicsRayQueryParameters3D.create(origin, origin + dir * range_m)
		q.collision_mask = 1 | 2          # 1 = world geometry, 2 = characters
		q.exclude = [shooter.get_rid()] if shooter is CollisionObject3D else []
		var hit := space.intersect_ray(q)
		if hit.is_empty():
			continue

		# falloff: full damage to 60% of range, then tapering to 55%
		var dist := origin.distance_to(hit["position"])
		var t := clampf((dist / range_m - 0.6) / 0.4, 0.0, 1.0)
		var falloff := lerpf(1.0, 0.55, t)

		results.append({
			"collider": hit.get("collider"),
			"position": hit["position"],
			"normal": hit.get("normal", Vector3.UP),
			"damage": dmg * falloff,
		})
	return results

static func rpm_to_interval(def: Dictionary) -> float:
	var rpm := float(def.get("rpm", 600.0))
	return 60.0 / maxf(rpm, 1.0)
