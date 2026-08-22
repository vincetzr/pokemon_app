class_name HUD
extends CanvasLayer
## All UI is built in code so there is no binary scene to hand-edit.

var player: Player

var _hp_bar: ProgressBar
var _hp_text: Label
var _weapon: Label
var _ammo: Label
var _alive: Label
var _zone: Label
var _feed: VBoxContainer
var _hitmark: Label
var _banner: Label
var _sub: Label
var _flash: ColorRect
var _crosshair: Control
var _spread := 0.0

const FONT_BIG := 34
const FONT_MED := 20
const FONT_SM := 15

func _ready() -> void:
	layer = 10
	_build()
	GameEvents.kill.connect(_on_kill)
	GameEvents.zone_phase.connect(_on_zone)
	GameEvents.player_hurt.connect(_on_hurt)
	GameEvents.impact.connect(_on_impact)
	GameEvents.match_over.connect(_on_match_over)

func bind(p: Player) -> void:
	player = p
	p.state_changed.connect(_refresh)
	_refresh()

func _mk_label(text: String, size: int, col: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("shadow_offset_x", 1)
	l.add_theme_constant_override("shadow_offset_y", 2)
	return l

func _build() -> void:
	_flash = ColorRect.new()
	_flash.color = Color(0.8, 0.05, 0.05, 0.0)
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_flash)

	# crosshair — four ticks that open up with spread
	_crosshair = Control.new()
	_crosshair.set_anchors_preset(Control.PRESET_CENTER)
	_crosshair.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_crosshair)
	for i in 4:
		var tick := ColorRect.new()
		tick.color = Color(1, 1, 1, 0.85)
		tick.size = Vector2(2, 8) if i < 2 else Vector2(8, 2)
		tick.name = "tick%d" % i
		_crosshair.add_child(tick)

	_hitmark = _mk_label("", 26, Color(1, 0.35, 0.3))
	_hitmark.set_anchors_preset(Control.PRESET_CENTER)
	_hitmark.position = Vector2(-9, -18)
	_hitmark.modulate.a = 0.0
	add_child(_hitmark)

	# bottom-left: health
	var hp_box := VBoxContainer.new()
	hp_box.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	hp_box.position = Vector2(26, -96)
	hp_box.custom_minimum_size = Vector2(280, 0)
	add_child(hp_box)

	_hp_text = _mk_label("100", FONT_MED, Color(0.85, 1.0, 0.85))
	hp_box.add_child(_hp_text)

	_hp_bar = ProgressBar.new()
	_hp_bar.custom_minimum_size = Vector2(280, 14)
	_hp_bar.max_value = 100.0
	_hp_bar.value = 100.0
	_hp_bar.show_percentage = false
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color(0.35, 0.85, 0.45)
	fill.corner_radius_top_left = 3
	fill.corner_radius_top_right = 3
	fill.corner_radius_bottom_left = 3
	fill.corner_radius_bottom_right = 3
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0.1, 0.1, 0.12, 0.85)
	bg.corner_radius_top_left = 3
	bg.corner_radius_bottom_right = 3
	_hp_bar.add_theme_stylebox_override("fill", fill)
	_hp_bar.add_theme_stylebox_override("background", bg)
	hp_box.add_child(_hp_bar)

	# bottom-right: weapon + ammo
	var w_box := VBoxContainer.new()
	w_box.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	w_box.position = Vector2(-250, -96)
	w_box.custom_minimum_size = Vector2(220, 0)
	w_box.alignment = BoxContainer.ALIGNMENT_END
	add_child(w_box)
	_weapon = _mk_label("Fists", FONT_MED, Color(0.95, 0.95, 1.0))
	_weapon.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_weapon.custom_minimum_size = Vector2(220, 0)
	w_box.add_child(_weapon)
	_ammo = _mk_label("— / —", FONT_BIG, Color(1, 0.92, 0.7))
	_ammo.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_ammo.custom_minimum_size = Vector2(220, 0)
	w_box.add_child(_ammo)

	# top-right: alive count and zone
	var t_box := VBoxContainer.new()
	t_box.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	t_box.position = Vector2(-250, 22)
	t_box.custom_minimum_size = Vector2(220, 0)
	add_child(t_box)
	_alive = _mk_label("ALIVE  10", FONT_MED, Color(1, 1, 1))
	_alive.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_alive.custom_minimum_size = Vector2(220, 0)
	t_box.add_child(_alive)
	_zone = _mk_label("Zone 1 · 20s", FONT_SM, Color(0.55, 0.85, 1.0))
	_zone.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_zone.custom_minimum_size = Vector2(220, 0)
	t_box.add_child(_zone)

	# top-left: kill feed
	_feed = VBoxContainer.new()
	_feed.set_anchors_preset(Control.PRESET_TOP_LEFT)
	_feed.position = Vector2(26, 22)
	add_child(_feed)

	# centre banner for win/lose
	_banner = _mk_label("", 56, Color(1, 0.85, 0.3))
	_banner.set_anchors_preset(Control.PRESET_CENTER)
	_banner.position = Vector2(-320, -70)
	_banner.custom_minimum_size = Vector2(640, 0)
	_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(_banner)
	_sub = _mk_label("", FONT_MED, Color(0.9, 0.9, 0.95))
	_sub.set_anchors_preset(Control.PRESET_CENTER)
	_sub.position = Vector2(-320, 0)
	_sub.custom_minimum_size = Vector2(640, 0)
	_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(_sub)

func _process(delta: float) -> void:
	_flash.color.a = maxf(0.0, _flash.color.a - delta * 1.6)
	_hitmark.modulate.a = maxf(0.0, _hitmark.modulate.a - delta * 2.2)

	var want := 6.0
	if player != null and player.alive:
		want = 6.0 + player.velocity.length() * 1.1
		if Input.is_physical_key_pressed(KEY_CTRL):
			want *= 0.6
	_spread = lerpf(_spread, want, delta * 8.0)
	for i in 4:
		var tick: ColorRect = _crosshair.get_node("tick%d" % i)
		match i:
			0: tick.position = Vector2(-1, -_spread - 8)
			1: tick.position = Vector2(-1,  _spread)
			2: tick.position = Vector2(-_spread - 8, -1)
			3: tick.position = Vector2( _spread, -1)

func _refresh() -> void:
	if player == null:
		return
	_hp_bar.value = player.health
	_hp_text.text = "%d" % roundi(player.health)
	var col := Color(0.35, 0.85, 0.45)
	if player.health < 55.0: col = Color(0.9, 0.75, 0.25)
	if player.health < 25.0: col = Color(0.9, 0.3, 0.28)
	var sb := _hp_bar.get_theme_stylebox("fill")
	if sb is StyleBoxFlat:
		sb.bg_color = col

	var def := Arsenal.get_def(player.weapon_id)
	_weapon.text = String(def.get("name", "—"))
	if player.weapon_id == "fists":
		_ammo.text = "—"
	elif player.reloading:
		_ammo.text = "RELOADING"
	else:
		_ammo.text = "%d / %d" % [player.ammo_in_mag, player.reserve_ammo]

func set_alive(n: int) -> void:
	_alive.text = "ALIVE  %d" % n

func _on_zone(phase: int, radius: float, secs: float) -> void:
	var verb := "closing" if radius > 0.0 else "final"
	_zone.text = "Zone %d - %s in %ds" % [maxi(phase, 1), verb, roundi(secs)]

func _on_hurt(_amount: float) -> void:
	_flash.color.a = 0.34

func _on_impact(_pos: Vector3, _n: Vector3, hit_character: bool) -> void:
	if hit_character:
		_hitmark.text = "X"
		_hitmark.modulate.a = 1.0

func _on_kill(killer: String, victim: String, alive_left: int) -> void:
	set_alive(alive_left)
	var l := _mk_label("%s  killed  %s" % [killer, victim], FONT_SM, Color(1, 1, 1, 0.92))
	if killer == "You":
		l.add_theme_color_override("font_color", Color(1, 0.85, 0.35))
	elif victim == "You":
		l.add_theme_color_override("font_color", Color(1, 0.4, 0.4))
	_feed.add_child(l)
	if _feed.get_child_count() > 5:
		_feed.get_child(0).queue_free()
	await get_tree().create_timer(6.0).timeout
	if is_instance_valid(l):
		l.queue_free()

func _on_match_over(won: bool, placement: int, kills: int) -> void:
	if won:
		_banner.text = "WINNER WINNER"
		_banner.add_theme_color_override("font_color", Color(1, 0.85, 0.3))
		_sub.text = "%d kills  -  1st of 10\n\nPress R to play again" % kills
	else:
		_banner.text = "ELIMINATED"
		_banner.add_theme_color_override("font_color", Color(0.95, 0.35, 0.32))
		_sub.text = "%d kills  -  #%d of 10\n\nPress R to play again" % [kills, placement]
