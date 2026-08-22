class_name Bot
extends CharacterBody3D
## AI opponent. Deliberately simple and readable: a small state machine over
## "get to safety / find a gun / kill what I can see". Bots are what make a
## solo battle royale playable at all — an empty lobby is not a game.

signal died(victim_name: String, killer_name: String)

enum S { ROAM, LOOT, ENGAGE, FLEE }

const SPEED_ROAM := 4.2
const SPEED_FLEE := 7.4
const SIGHT := 95.0
const FOV_DOT := 0.35          # ~110 degrees of vision
const REPATH := 1.4

var display_name := "Bot"
var health := 100.0
var alive := true
var skill := 0.5               # 0 = hopeless, 1 = deadly

var weapon_id := "fists"
var ammo_in_mag := 0
var state: int = S.ROAM
var target: Node3D = null

var _dest := Vector3.ZERO
var _repath := 0.0
var _next_shot := 0.0
var _reload_until := 0.0
var _stuck := 0.0
var _last_pos := Vector3.ZERO
var _burst := 0

var world: World
var zone: Zone
var arena: Node3D             # parent that holds all combatants
var rng := RandomNumberGenerator.new()

func _ready() -> void:
	rng.randomize()
	collision_layer = 2
	collision_mask = 1
	floor_max_angle = deg_to_rad(55)
	_build_body()
	_dest = global_position

func _build_body() -> void:
	var caps := CapsuleShape3D.new()
	caps.radius = 0.42
	caps.height = 1.75
	var cs := CollisionShape3D.new()
	cs.shape = caps
	cs.position.y = 0.875
	add_child(cs)

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color.from_hsv(rng.randf(), 0.45, 0.72)
	mat.roughness = 0.7

	var body := MeshInstance3D.new()
	var cm := CapsuleMesh.new()
	cm.radius = 0.42
	cm.height = 1.75
	body.mesh = cm
	body.position.y = 0.875
	body.material_override = mat
	add_child(body)

	var head := MeshInstance3D.new()
	var hm := SphereMesh.new()
	hm.radius = 0.22
	hm.height = 0.44
	head.mesh = hm
	head.position.y = 1.78
	var hmat := StandardMaterial3D.new()
	hmat.albedo_color = Color(0.85, 0.72, 0.6)
	head.material_override = hmat
	add_child(head)

func setup(w: World, z: Zone, a: Node3D, difficulty: float) -> void:
	world = w
	zone = z
	arena = a
	skill = clampf(difficulty, 0.05, 1.0)
	# Everyone lands empty-handed, player included. Bots must loot like you do.

func _equip(id: String) -> void:
	weapon_id = id
	ammo_in_mag = int(Arsenal.get_def(id).get("mag", 0))

func _physics_process(delta: float) -> void:
	if not alive:
		return
	_next_shot = maxf(0.0, _next_shot - delta)
	_reload_until = maxf(0.0, _reload_until - delta)
	_repath -= delta

	_think(delta)
	_move(delta)
	_apply_gravity(delta)
	move_and_slide()
	_detect_stuck(delta)

func _think(_delta: float) -> void:
	# zone always wins: being caught outside is certain death
	if zone != null and zone.is_outside(global_position):
		state = S.FLEE
		_dest = zone.safe_target(global_position)
		target = null
		return

	var seen := _find_target()
	if seen != null:
		target = seen
		state = S.ENGAGE
		return

	if target != null and not _is_valid(target):
		target = null
	if state == S.ENGAGE and target == null:
		state = S.ROAM

	if state != S.ENGAGE and _repath <= 0.0:
		_repath = REPATH
		if weapon_id == "fists" and world != null and not world.loot_points.is_empty():
			state = S.LOOT
			_dest = world.loot_points[rng.randi() % world.loot_points.size()]
		else:
			state = S.ROAM
			_dest = _wander_point()

func _wander_point() -> Vector3:
	var c: Vector3 = zone.centre if zone != null else Vector3.ZERO
	var r: float = (zone.radius if zone != null else 120.0) * 0.72
	var a := rng.randf() * TAU
	var d := sqrt(rng.randf()) * r
	var x := c.x + cos(a) * d
	var z := c.z + sin(a) * d
	var y := world.height_at(x, z) if world != null else 0.0
	return Vector3(x, y, z)

func _find_target() -> Node3D:
	if arena == null:
		return null
	var best: Node3D = null
	var best_d := SIGHT
	var eye := global_position + Vector3.UP * 1.6
	for child in arena.get_children():
		var n := child as Node3D
		if n == null or n == self or not _is_valid(n):
			continue
		var d := global_position.distance_to(n.global_position)
		if d > best_d:
			continue
		var to := (n.global_position - global_position).normalized()
		if to.dot(-global_transform.basis.z) < FOV_DOT and state != S.ENGAGE:
			continue                                   # not in view cone
		if not _has_los(eye, n.global_position + Vector3.UP * 1.2, n):
			continue
		best = n
		best_d = d
	return best

func _has_los(from: Vector3, to: Vector3, ignore: Node3D) -> bool:
	var q := PhysicsRayQueryParameters3D.create(from, to)
	q.collision_mask = 1 | 2
	q.exclude = [get_rid()]
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		return true
	return hit.get("collider") == ignore

func _is_valid(n: Node) -> bool:
	return is_instance_valid(n) and n.get("alive") == true

func _move(delta: float) -> void:
	var speed := SPEED_ROAM
	var goal := _dest

	if state == S.FLEE:
		speed = SPEED_FLEE
	elif state == S.ENGAGE and target != null:
		var d := global_position.distance_to(target.global_position)
		var ideal := clampf(float(Arsenal.get_def(weapon_id).get("range", 60.0)) * 0.35, 6.0, 40.0)
		# strafe around the target at a comfortable range for the gun held
		var to_t := (target.global_position - global_position)
		to_t.y = 0.0
		var side := to_t.normalized().cross(Vector3.UP)
		goal = target.global_position - to_t.normalized() * ideal + side * sin(float(Time.get_ticks_msec()) * 0.001) * 6.0
		speed = SPEED_ROAM * 1.15
		if d < ideal * 0.5:
			goal = global_position - to_t.normalized() * 8.0
		_shoot_at(target, delta)

	var flat := goal - global_position
	flat.y = 0.0
	if flat.length() > 1.2:
		var dir := flat.normalized()
		velocity.x = dir.x * speed
		velocity.z = dir.z * speed
		var face: Vector3 = target.global_position if (state == S.ENGAGE and target != null) else goal
		_face(face, delta)
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)
		if state != S.ENGAGE:
			_repath = 0.0

func _face(point: Vector3, delta: float) -> void:
	var flat := point - global_position
	flat.y = 0.0
	if flat.length_squared() < 0.01:
		return
	var want := atan2(-flat.x, -flat.z)
	rotation.y = lerp_angle(rotation.y, want, delta * 7.0)

func _apply_gravity(delta: float) -> void:
	if is_on_floor():
		velocity.y = -2.0
	else:
		velocity.y -= 26.0 * delta

func _shoot_at(t: Node3D, _delta: float) -> void:
	if _next_shot > 0.0 or _reload_until > 0.0:
		return
	var def := Arsenal.get_def(weapon_id)
	if weapon_id != "fists" and ammo_in_mag <= 0:
		_reload_until = float(def.get("reload", 2.0))
		ammo_in_mag = int(def.get("mag", 0))
		return

	var eye := global_position + Vector3.UP * 1.6
	var aim := (t.global_position + Vector3.UP * 1.0) - eye
	if aim.length() > float(def.get("range", 100.0)):
		return

	_next_shot = Arsenal.rpm_to_interval(def)
	if weapon_id != "fists":
		ammo_in_mag -= 1

	# worse bots spray wider; everyone is worse at long range
	var acc := lerpf(3.4, 0.9, skill)
	acc *= 1.0 + clampf(aim.length() / 120.0, 0.0, 1.4)

	var hits := Arsenal.fire(get_world_3d(), eye, aim.normalized(), def, self, rng, acc)
	for h in hits:
		var c = h["collider"]
		if c != null and c.has_method("take_damage"):
			c.take_damage(float(h["damage"]), display_name)
		GameEvents.impact.emit(h["position"], h["normal"], c != null and c.has_method("take_damage"))
	GameEvents.shot_fired.emit(global_position, weapon_id)

func _detect_stuck(delta: float) -> void:
	if global_position.distance_to(_last_pos) < 0.06 and state != S.ENGAGE:
		_stuck += delta
		if _stuck > 1.1:
			_stuck = 0.0
			_dest = _wander_point()
			velocity.y = 6.0            # hop over whatever is in the way
	else:
		_stuck = 0.0
	_last_pos = global_position

func take_damage(amount: float, source_name: String = "") -> void:
	if not alive:
		return
	health -= amount
	# being shot from out of view makes a bot turn and look
	if state != S.ENGAGE:
		_repath = 0.0
	if health <= 0.0:
		alive = false
		died.emit(display_name, source_name)
		_die()

func _die() -> void:
	set_physics_process(false)
	var t := create_tween()
	t.tween_property(self, "rotation:z", deg_to_rad(88.0), 0.35)
	t.parallel().tween_property(self, "position:y", global_position.y - 0.4, 0.35)
	await get_tree().create_timer(6.0).timeout
	queue_free()

func pickup_weapon(id: String) -> void:
	_equip(id)
