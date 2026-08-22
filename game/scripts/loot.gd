class_name Loot
extends Area3D
## A pickup on the ground. Walk over it to take it.

enum Kind { WEAPON, AMMO, MEDKIT }

var kind: int = Kind.WEAPON
var weapon_id := "smg"
var amount := 0
var label := ""

func setup(k: int, id: String = "", amt: int = 0) -> void:
	kind = k
	weapon_id = id
	amount = amt

func _ready() -> void:
	collision_layer = 4
	collision_mask = 2                 # only characters trip it
	monitoring = true

	var cs := CollisionShape3D.new()
	var sp := SphereShape3D.new()
	sp.radius = 1.5
	cs.shape = sp
	cs.position.y = 0.7
	add_child(cs)

	var mi := MeshInstance3D.new()
	var mat := StandardMaterial3D.new()
	mat.emission_enabled = true
	mat.emission_energy_multiplier = 1.4
	mat.roughness = 0.4

	match kind:
		Kind.WEAPON:
			var bm := BoxMesh.new()
			bm.size = Vector3(1.05, 0.22, 0.22)
			mi.mesh = bm
			var c := Color(String(Arsenal.get_def(weapon_id).get("color", "#ffffff")))
			mat.albedo_color = c
			mat.emission = c
			label = String(Arsenal.get_def(weapon_id).get("name", weapon_id))
		Kind.AMMO:
			var bm2 := BoxMesh.new()
			bm2.size = Vector3(0.4, 0.34, 0.4)
			mi.mesh = bm2
			mat.albedo_color = Color(0.85, 0.78, 0.35)
			mat.emission = Color(0.7, 0.6, 0.2)
			label = "%d rounds" % amount
		Kind.MEDKIT:
			var bm3 := BoxMesh.new()
			bm3.size = Vector3(0.5, 0.34, 0.36)
			mi.mesh = bm3
			mat.albedo_color = Color(0.9, 0.25, 0.3)
			mat.emission = Color(0.8, 0.15, 0.2)
			label = "Medkit"

	mi.material_override = mat
	mi.position.y = 0.7
	add_child(mi)

	# a slow bob + spin so loot is findable from a distance
	var t := create_tween().set_loops()
	t.tween_property(mi, "position:y", 0.95, 1.2).set_trans(Tween.TRANS_SINE)
	t.tween_property(mi, "position:y", 0.7, 1.2).set_trans(Tween.TRANS_SINE)
	var r := create_tween().set_loops()
	r.tween_property(mi, "rotation:y", TAU, 3.5).from(0.0)

	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node3D) -> void:
	if not body.has_method("pickup_weapon"):
		return
	if body.get("alive") != true:
		return
	match kind:
		Kind.WEAPON:
			body.pickup_weapon(weapon_id)
		Kind.AMMO:
			if body.has_method("add_ammo"):
				body.add_ammo(amount)
			else:
				return                  # bots do not track reserve ammo; leave it
		Kind.MEDKIT:
			if body.has_method("heal"):
				body.heal(45.0)
			else:
				return
	if body is Player:
		GameEvents.impact.emit(global_position, Vector3.UP, false)
	queue_free()
