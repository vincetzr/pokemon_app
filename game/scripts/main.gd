extends Node3D
## Match controller: builds the island, drops ten combatants on it, runs the
## zone, and decides who won.

const LOBBY := 10                      # you + 9 bots
const BOT_NAMES := [
	"Volkov", "Mireille", "Ashgrove", "Kestrel", "Dorian", "Sable", "Fenwick",
	"Ianthe", "Rooker", "Calloway", "Wren", "Ozawa", "Bright", "Ferris",
]

var world: World
var zone: Zone
var hud: HUD
var player: Player
var arena: Node3D

var alive_count := LOBBY
var kills := 0
var match_seed := 0
var _over := false
var _zone_tick := 0.0
var rng := RandomNumberGenerator.new()

func _ready() -> void:
	rng.randomize()
	match_seed = rng.randi()
	_start_match()

func _start_match() -> void:
	_over = false
	alive_count = LOBBY
	kills = 0

	_build_sky()

	world = World.new()
	world.name = "World"
	add_child(world)
	world.build(match_seed)

	zone = Zone.new()
	zone.name = "Zone"
	add_child(zone)

	arena = Node3D.new()
	arena.name = "Arena"
	add_child(arena)

	_spawn_player()
	_spawn_bots()
	_spawn_loot()

	hud = HUD.new()
	add_child(hud)
	hud.bind(player)
	hud.set_alive(alive_count)

func _build_sky() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.22, 0.35, 0.58)
	sky_mat.sky_horizon_color = Color(0.68, 0.71, 0.72)
	sky_mat.ground_bottom_color = Color(0.14, 0.15, 0.16)
	sky_mat.ground_horizon_color = Color(0.6, 0.62, 0.62)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	e.ambient_light_energy = 0.45
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.tonemap_exposure = 1.0
	e.fog_enabled = true
	e.fog_light_color = Color(0.62, 0.68, 0.74)
	e.fog_density = 0.0022
	env.environment = e
	add_child(env)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-46, 38, 0)
	sun.light_energy = 1.05
	sun.light_color = Color(1.0, 0.96, 0.88)
	sun.shadow_enabled = true
	add_child(sun)

func _spawn_player() -> void:
	player = Player.new()
	player.name = "Player"
	player.display_name = "You"
	arena.add_child(player)
	player.global_position = _spawn_at(0)
	player.died.connect(_on_player_died)

func _spawn_bots() -> void:
	var names := BOT_NAMES.duplicate()
	for i in range(1, LOBBY):
		var b := Bot.new()
		b.display_name = String(names[rng.randi() % names.size()])
		names.erase(b.display_name)
		arena.add_child(b)
		b.global_position = _spawn_at(i)
		# a spread of skill so the lobby is not uniformly lethal
		b.setup(world, zone, arena, rng.randf_range(0.2, 0.9))
		b.died.connect(_on_bot_died)

func _spawn_at(i: int) -> Vector3:
	if world.spawn_points.is_empty():
		return Vector3(0, 20, 0)
	return world.spawn_points[i % world.spawn_points.size()]

func _spawn_loot() -> void:
	for p in world.loot_points:
		var roll := rng.randf()
		var l := Loot.new()
		if roll < 0.52:
			l.setup(Loot.Kind.WEAPON, Arsenal.random_weapon_id(rng))
		elif roll < 0.82:
			l.setup(Loot.Kind.AMMO, "", rng.randi_range(30, 90))
		else:
			l.setup(Loot.Kind.MEDKIT)
		add_child(l)
		l.global_position = p

func _process(delta: float) -> void:
	if _over:
		if Input.is_physical_key_pressed(KEY_R):
			_restart()
		return

	_zone_tick += delta
	if _zone_tick >= 0.5:
		_apply_zone_damage(_zone_tick)
		_zone_tick = 0.0

func _apply_zone_damage(dt: float) -> void:
	if zone == null or zone.dps <= 0.0:
		return
	for n in arena.get_children():
		if n.get("alive") != true:
			continue
		if zone.is_outside(n.global_position):
			n.take_damage(zone.dps * dt, "the zone")

func _on_bot_died(victim: String, killer: String) -> void:
	alive_count -= 1
	if killer == "You":
		kills += 1
	GameEvents.kill.emit(killer if killer != "" else "the zone", victim, alive_count)
	if alive_count <= 1 and player.alive:
		_finish(true)

func _on_player_died(killer: String) -> void:
	alive_count -= 1
	GameEvents.kill.emit(killer if killer != "" else "the zone", "You", alive_count)
	_finish(false)

func _finish(won: bool) -> void:
	if _over:
		return
	_over = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	GameEvents.match_over.emit(won, alive_count + 1, kills)

func _restart() -> void:
	match_seed = rng.randi()
	for c in get_children():
		c.queue_free()
	await get_tree().process_frame
	_start_match()
