class_name Zone
extends Node3D
## The shrinking play area. This is the mechanic that makes a battle royale a
## battle royale: it forces the fight, so the match cannot stall.

signal phase_changed(phase: int)

const PHASES := [
	# radius, hold seconds, shrink seconds, damage/sec outside
	{ "r": 190.0, "hold": 42.0, "shrink": 34.0, "dps": 1.0 },
	{ "r": 120.0, "hold": 34.0, "shrink": 30.0, "dps": 2.5 },
	{ "r": 72.0,  "hold": 28.0, "shrink": 26.0, "dps": 5.0 },
	{ "r": 38.0,  "hold": 24.0, "shrink": 22.0, "dps": 9.0 },
	{ "r": 16.0,  "hold": 20.0, "shrink": 18.0, "dps": 15.0 },
	{ "r": 0.0,   "hold": 9999.0, "shrink": 1.0, "dps": 22.0 },
]

var phase := 0
var centre := Vector3.ZERO
var radius := 205.0
var target_radius := 205.0
var dps := 0.0

var _timer := 0.0
var _shrinking := false
var _from_radius := 205.0
var _from_centre := Vector3.ZERO
var _target_centre := Vector3.ZERO
var _shrink_len := 1.0
var _wall: MeshInstance3D
var rng := RandomNumberGenerator.new()

func _ready() -> void:
	rng.randomize()
	radius = 205.0
	target_radius = radius
	_timer = 25.0                      # grace period before the first shrink
	_build_wall()

func _build_wall() -> void:
	_wall = MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.0
	cyl.bottom_radius = 1.0
	cyl.height = 1.0
	cyl.radial_segments = 96
	cyl.cap_top = false
	cyl.cap_bottom = false
	_wall.mesh = cyl

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.24, 0.72, 1.0, 0.13)
	mat.emission_enabled = true
	mat.emission = Color(0.3, 0.8, 1.0)
	mat.emission_energy_multiplier = 1.6
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_wall.material_override = mat
	_wall.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_wall)

func _process(delta: float) -> void:
	_timer -= delta
	if _shrinking:
		var t := 1.0 - clampf(_timer / _shrink_len, 0.0, 1.0)
		radius = lerpf(_from_radius, target_radius, t)
		centre = _from_centre.lerp(_target_centre, t)
		if _timer <= 0.0:
			_shrinking = false
			radius = target_radius
			centre = _target_centre
			_timer = float(PHASES[mini(phase, PHASES.size() - 1)]["hold"])
	elif _timer <= 0.0:
		_advance_phase()

	_wall.scale = Vector3(maxf(radius, 0.5), 420.0, maxf(radius, 0.5))
	_wall.position = centre
	GameEvents.zone_phase.emit(phase, radius, maxf(_timer, 0.0))

func _advance_phase() -> void:
	if phase >= PHASES.size():
		return
	var p: Dictionary = PHASES[phase]
	_from_radius = radius
	_from_centre = centre
	target_radius = float(p["r"])
	# the next circle is placed inside the current one, so running is survivable
	var drift := maxf(radius - target_radius, 0.0) * 0.55
	var a := rng.randf() * TAU
	_target_centre = centre + Vector3(cos(a), 0.0, sin(a)) * rng.randf() * drift
	dps = float(p["dps"])
	_shrink_len = float(p["shrink"])
	_timer = _shrink_len
	_shrinking = true
	phase += 1
	phase_changed.emit(phase)

func is_outside(pos: Vector3) -> bool:
	return Vector2(pos.x - centre.x, pos.z - centre.z).length() > radius

## Nearest safe point, used by bots to decide where to run.
func safe_target(from: Vector3) -> Vector3:
	var flat := Vector2(from.x - centre.x, from.z - centre.z)
	if flat.length() <= radius * 0.75:
		return from
	var dir := flat.normalized() * (radius * 0.6)
	return Vector3(centre.x + dir.x, from.y, centre.z + dir.y)
