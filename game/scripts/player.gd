class_name Player
extends CharacterBody3D
## First-person controller. Raw key polling rather than an InputMap so the whole
## control scheme lives in one readable place; remapping comes later.

signal died(killer_name: String)
signal state_changed          # HUD repaint hint (health / ammo / weapon)

const WALK := 5.4
const SPRINT := 9.2
const CROUCH := 2.8
const JUMP_V := 8.0
const ACCEL_GROUND := 12.0
const ACCEL_AIR := 2.5
const MOUSE_SENS := 0.0022
const STAND_H := 1.75
const CROUCH_H := 1.05

var health := 100.0
var alive := true
var display_name := "You"

var weapon_id := "fists"
var ammo_in_mag := 0
var reserve_ammo := 0
var reloading := false
var _next_shot := 0.0
var _crouching := false
var _recoil := 0.0

var cam: Camera3D
var _collider: CollisionShape3D
var _capsule: CapsuleShape3D
var rng := RandomNumberGenerator.new()

func _ready() -> void:
	rng.randomize()
	collision_layer = 2          # characters
	collision_mask = 1           # collide with world only; bodies pass through each other
	floor_max_angle = deg_to_rad(52)

	_capsule = CapsuleShape3D.new()
	_capsule.radius = 0.42
	_capsule.height = STAND_H
	_collider = CollisionShape3D.new()
	_collider.shape = _capsule
	_collider.position.y = STAND_H * 0.5
	add_child(_collider)

	cam = Camera3D.new()
	cam.position.y = STAND_H - 0.18
	cam.fov = 78.0
	cam.far = 900.0
	add_child(cam)

	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
	if not alive:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-event.relative.x * MOUSE_SENS)
		cam.rotation.x = clampf(cam.rotation.x - event.relative.y * MOUSE_SENS, -1.45, 1.45)
	elif event is InputEventMouseButton and event.pressed:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _physics_process(delta: float) -> void:
	if not alive:
		return

	_next_shot = maxf(0.0, _next_shot - delta)
	_recoil = lerpf(_recoil, 0.0, delta * 6.0)

	_handle_crouch(delta)
	_handle_movement(delta)
	_handle_shooting(delta)

	if Input.is_physical_key_pressed(KEY_R):
		_start_reload()

func _handle_crouch(delta: float) -> void:
	var want := Input.is_physical_key_pressed(KEY_CTRL) or Input.is_physical_key_pressed(KEY_C)
	if want != _crouching:
		_crouching = want
	var target_h := CROUCH_H if _crouching else STAND_H
	_capsule.height = lerpf(_capsule.height, target_h, delta * 12.0)
	_collider.position.y = _capsule.height * 0.5
	cam.position.y = lerpf(cam.position.y, _capsule.height - 0.18, delta * 12.0)

func _handle_movement(delta: float) -> void:
	var input_dir := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_W): input_dir.y -= 1.0
	if Input.is_physical_key_pressed(KEY_S): input_dir.y += 1.0
	if Input.is_physical_key_pressed(KEY_A): input_dir.x -= 1.0
	if Input.is_physical_key_pressed(KEY_D): input_dir.x += 1.0
	input_dir = input_dir.normalized()

	var sprinting := Input.is_physical_key_pressed(KEY_SHIFT) and input_dir.y < 0.0 and not _crouching
	var speed := CROUCH if _crouching else (SPRINT if sprinting else WALK)

	var wish := (transform.basis * Vector3(input_dir.x, 0.0, input_dir.y)).normalized()
	var accel := ACCEL_GROUND if is_on_floor() else ACCEL_AIR
	var target := wish * speed
	velocity.x = lerpf(velocity.x, target.x, accel * delta)
	velocity.z = lerpf(velocity.z, target.z, accel * delta)

	if is_on_floor():
		if Input.is_physical_key_pressed(KEY_SPACE):
			velocity.y = JUMP_V
		else:
			velocity.y = -2.0
	else:
		velocity.y -= 26.0 * delta

	move_and_slide()

func _handle_shooting(_delta: float) -> void:
	if reloading or _next_shot > 0.0:
		return
	var def := Arsenal.get_def(weapon_id)
	var auto := bool(def.get("auto", true))
	var pressed := Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	if not pressed:
		return
	if not auto and _held_trigger:
		return
	_held_trigger = pressed

	if weapon_id != "fists" and ammo_in_mag <= 0:
		_start_reload()
		return

	_fire(def)

var _held_trigger := false

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and not event.pressed:
		_held_trigger = false

func _fire(def: Dictionary) -> void:
	_next_shot = Arsenal.rpm_to_interval(def)
	if weapon_id != "fists":
		ammo_in_mag -= 1
	# aim spread grows while sprinting or airborne, shrinks while crouched
	var acc := 1.0
	if not is_on_floor(): acc *= 2.4
	elif _crouching: acc *= 0.55
	acc *= 1.0 + _recoil * 2.0

	var hits := Arsenal.fire(get_world_3d(), cam.global_position, -cam.global_transform.basis.z,
		def, self, rng, acc)
	for h in hits:
		var c = h["collider"]
		if c != null and c.has_method("take_damage"):
			c.take_damage(float(h["damage"]), display_name)
		GameEvents.impact.emit(h["position"], h["normal"], c != null and c.has_method("take_damage"))

	_recoil = minf(_recoil + 0.16, 1.0)
	cam.rotation.x = clampf(cam.rotation.x + 0.011 + randf() * 0.006, -1.45, 1.45)
	GameEvents.shot_fired.emit(global_position, weapon_id)
	state_changed.emit()

func _start_reload() -> void:
	var def := Arsenal.get_def(weapon_id)
	var mag := int(def.get("mag", 0))
	if reloading or weapon_id == "fists" or ammo_in_mag >= mag or reserve_ammo <= 0:
		return
	reloading = true
	state_changed.emit()
	await get_tree().create_timer(float(def.get("reload", 2.0))).timeout
	if not alive:
		return
	var need := mag - ammo_in_mag
	var take := mini(need, reserve_ammo)
	ammo_in_mag += take
	reserve_ammo -= take
	reloading = false
	state_changed.emit()

func take_damage(amount: float, source_name: String = "") -> void:
	if not alive:
		return
	health = maxf(0.0, health - amount)
	GameEvents.player_hurt.emit(amount)
	state_changed.emit()
	if health <= 0.0:
		alive = false
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		died.emit(source_name)

func heal(amount: float) -> void:
	health = minf(100.0, health + amount)
	state_changed.emit()

func pickup_weapon(id: String) -> void:
	weapon_id = id
	var def := Arsenal.get_def(id)
	ammo_in_mag = int(def.get("mag", 0))
	reserve_ammo = maxi(reserve_ammo, int(def.get("mag", 0)) * 2)
	reloading = false
	state_changed.emit()

func add_ammo(n: int) -> void:
	reserve_ammo += n
	state_changed.emit()
