class_name World
extends Node3D
## Procedural island: heightmapped terrain, compounds, treelines, loot.
## Everything is generated from a seed so the map is reproducible.

const MAP_SIZE := 420.0        # world is MAP_SIZE x MAP_SIZE metres, centred on origin
const GRID := 128              # terrain resolution (vertices per side)
const AMPLITUDE := 26.0

var noise := FastNoiseLite.new()
var detail := FastNoiseLite.new()
var rng := RandomNumberGenerator.new()
var loot_points: Array[Vector3] = []
var compound_centres: Array[Vector2] = []
var spawn_points: Array[Vector3] = []

func build(map_seed: int) -> void:
	rng.seed = map_seed
	noise.seed = map_seed
	noise.frequency = 0.0115          # ~90m between ridgelines: hills you can use as cover
	noise.fractal_octaves = 5
	noise.fractal_lacunarity = 2.2
	noise.fractal_gain = 0.48
	detail.seed = map_seed + 7
	detail.frequency = 0.045
	detail.fractal_octaves = 2

	_build_terrain()
	_build_water_plane()
	_scatter_compounds(14)
	_scatter_treeline(430)
	_scatter_rocks(130)
	_pick_spawn_points(24)

## Terrain height at a world position. Falls off at the edges so the island
## is ringed by water instead of ending at a cliff.
func height_at(x: float, z: float) -> float:
	var h := noise.get_noise_2d(x, z) * AMPLITUDE
	h += detail.get_noise_2d(x, z) * 2.4          # small undulation underfoot
	var d := Vector2(x, z).length() / (MAP_SIZE * 0.5)
	var falloff := clampf(1.0 - pow(maxf(d - 0.55, 0.0) / 0.45, 1.7), 0.0, 1.0)
	return h * falloff - (1.0 - falloff) * 12.0

## Terrain tint: sand at the waterline, grass on the flats, rock on steep faces.
func _ground_colour(pos: Vector3) -> Color:
	var e := 1.2
	var slope := absf(height_at(pos.x + e, pos.z) - height_at(pos.x - e, pos.z)) \
		+ absf(height_at(pos.x, pos.z + e) - height_at(pos.x, pos.z - e))
	slope /= (4.0 * e)

	var grass := Color(0.13, 0.19, 0.09).lerp(Color(0.31, 0.34, 0.16),
		clampf(detail.get_noise_2d(pos.x * 0.7, pos.z * 0.7) * 0.5 + 0.5, 0.0, 1.0))
	var sand := Color(0.46, 0.41, 0.29)
	var rock := Color(0.23, 0.22, 0.20)

	var c := grass
	if pos.y < 0.8:
		c = sand.lerp(grass, clampf((pos.y + 2.2) / 3.0, 0.0, 1.0))
	return c.lerp(rock, clampf((slope - 0.52) / 0.45, 0.0, 1.0))

func _build_terrain() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var step := MAP_SIZE / float(GRID)
	var half := MAP_SIZE * 0.5

	for i in GRID:
		for j in GRID:
			var x0 := -half + i * step
			var z0 := -half + j * step
			var x1 := x0 + step
			var z1 := z0 + step
			var a := Vector3(x0, height_at(x0, z0), z0)
			var b := Vector3(x1, height_at(x1, z0), z0)
			var c := Vector3(x1, height_at(x1, z1), z1)
			var d := Vector3(x0, height_at(x0, z1), z1)
			for v in [a, b, c, a, c, d]:
				st.set_color(_ground_colour(v))
				st.set_uv(Vector2(v.x, v.z) * 0.05)
				st.add_vertex(v)

	st.generate_normals()
	var mi := MeshInstance3D.new()
	mi.name = "Terrain"
	mi.mesh = st.commit()

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color.WHITE
	mat.vertex_color_use_as_albedo = true
	mat.vertex_color_is_srgb = true
	mat.roughness = 1.0
	mat.metallic = 0.0
	mi.material_override = mat
	add_child(mi)
	mi.create_trimesh_collision()
	# create_trimesh_collision() parents a StaticBody3D under the mesh
	for child in mi.get_children():
		if child is StaticBody3D:
			child.collision_layer = 1
			child.collision_mask = 0

func _build_water_plane() -> void:
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(MAP_SIZE * 2.0, MAP_SIZE * 2.0)
	mi.mesh = pm
	mi.position.y = -6.0
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.06, 0.15, 0.26, 0.82)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.roughness = 0.08
	mat.metallic = 0.5
	mi.material_override = mat
	add_child(mi)

## A compound is a cluster of buildings — the places worth looting and fighting over.
func _scatter_compounds(count: int) -> void:
	var placed: Array[Vector2] = []
	var attempts := 0
	while placed.size() < count and attempts < 400:
		attempts += 1
		var p := Vector2(rng.randf_range(-155, 155), rng.randf_range(-155, 155))
		if height_at(p.x, p.y) < 1.0:
			continue                                  # keep compounds out of the sea
		var too_close := false
		for q in placed:
			if p.distance_to(q) < 46.0:
				too_close = true
				break
		if too_close:
			continue
		placed.append(p)
		compound_centres.append(p)
		_build_compound(p)

func _build_compound(centre: Vector2) -> void:
	var buildings := rng.randi_range(2, 5)
	for i in buildings:
		var off := Vector2(rng.randf_range(-14, 14), rng.randf_range(-14, 14))
		var p := centre + off
		var w := rng.randf_range(7.0, 14.0)
		var d := rng.randf_range(7.0, 14.0)
		var h := rng.randf_range(4.0, 8.0)
		var base := _pad_height(p, w, d)
		_build_hut(Vector3(p.x, base, p.y), w, d, h)
		# loot sits inside buildings, which is what pulls players into them
		for k in rng.randi_range(1, 3):
			loot_points.append(Vector3(
				p.x + rng.randf_range(-w * 0.35, w * 0.35),
				base + 0.6,
				p.y + rng.randf_range(-d * 0.35, d * 0.35)))

## Four walls with a doorway gap, plus a roof. Cheap, but it reads as a building
## and gives real cover to fight around.
## Highest ground under the building footprint, so no corner is left hanging.
func _pad_height(centre: Vector2, w: float, d: float) -> float:
	var best := -999.0
	for sx in [-0.5, 0.0, 0.5]:
		for sz in [-0.5, 0.0, 0.5]:
			best = maxf(best, height_at(centre.x + w * sx, centre.y + d * sz))
	return best

func _build_hut(pos: Vector3, w: float, d: float, h: float) -> void:
	var body := StaticBody3D.new()
	body.position = pos
	body.collision_layer = 1
	body.collision_mask = 0
	add_child(body)

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.52, 0.46, 0.38).lerp(Color(0.3, 0.3, 0.33), rng.randf() * 0.6)
	mat.roughness = 0.9

	var t := 0.4
	var door_side := rng.randi_range(0, 3)
	var walls := [
		{ "sz": Vector3(w, h, t),  "ps": Vector3(0, h * 0.5, -d * 0.5) },
		{ "sz": Vector3(w, h, t),  "ps": Vector3(0, h * 0.5,  d * 0.5) },
		{ "sz": Vector3(t, h, d),  "ps": Vector3(-w * 0.5, h * 0.5, 0) },
		{ "sz": Vector3(t, h, d),  "ps": Vector3( w * 0.5, h * 0.5, 0) },
	]
	for i in walls.size():
		if i == door_side:
			# split this wall into two stubs, leaving a gap to walk through
			var sz: Vector3 = walls[i]["sz"]
			var ps: Vector3 = walls[i]["ps"]
			var along := "x" if sz.x > sz.z else "z"
			var full: float = sz.x if along == "x" else sz.z
			var stub := (full - 3.0) * 0.5
			if stub <= 0.2:
				_add_box(body, sz, ps, mat)
				continue
			for s in [-1.0, 1.0]:
				var s_sz := sz
				var s_ps := ps
				if along == "x":
					s_sz.x = stub
					s_ps.x = s * (stub + 3.0) * 0.5
				else:
					s_sz.z = stub
					s_ps.z = s * (stub + 3.0) * 0.5
				_add_box(body, s_sz, s_ps, mat)
		else:
			_add_box(body, walls[i]["sz"], walls[i]["ps"], mat)

	var plinth := StandardMaterial3D.new()
	plinth.albedo_color = Color(0.34, 0.33, 0.31)
	plinth.roughness = 1.0
	_add_box(body, Vector3(w + 0.5, 6.0, d + 0.5), Vector3(0, -3.0, 0), plinth)

	var roof := StandardMaterial3D.new()
	roof.albedo_color = Color(0.33, 0.21, 0.17)
	roof.roughness = 0.95
	_add_box(body, Vector3(w + 0.8, 0.35, d + 0.8), Vector3(0, h, 0), roof)

func _add_box(parent: Node3D, size: Vector3, pos: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.material_override = mat
	parent.add_child(mi)

	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	cs.position = pos
	parent.add_child(cs)

func _scatter_treeline(count: int) -> void:
	var trunk_mat := StandardMaterial3D.new()
	trunk_mat.albedo_color = Color(0.24, 0.17, 0.11)
	var leaf_mat := StandardMaterial3D.new()
	leaf_mat.albedo_color = Color(0.16, 0.32, 0.15)
	leaf_mat.roughness = 1.0

	for i in count:
		var x := rng.randf_range(-190, 190)
		var z := rng.randf_range(-190, 190)
		var y := height_at(x, z)
		if y < 0.5:
			continue
		var body := StaticBody3D.new()
		body.position = Vector3(x, y, z)
		body.collision_layer = 1
		body.collision_mask = 0
		add_child(body)

		var th := rng.randf_range(4.0, 8.0)
		var trunk := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.28
		cyl.bottom_radius = 0.42
		cyl.height = th
		trunk.mesh = cyl
		trunk.position.y = th * 0.5
		trunk.material_override = trunk_mat
		body.add_child(trunk)

		var cs := CollisionShape3D.new()
		var caps := CylinderShape3D.new()
		caps.radius = 0.42
		caps.height = th
		cs.shape = caps
		cs.position.y = th * 0.5
		body.add_child(cs)

		var canopy := MeshInstance3D.new()
		var sm := SphereMesh.new()
		var r := rng.randf_range(2.2, 3.6)
		sm.radius = r
		sm.height = r * 2.0
		canopy.mesh = sm
		canopy.position.y = th + r * 0.35
		canopy.material_override = leaf_mat
		body.add_child(canopy)

func _scatter_rocks(count: int) -> void:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.42, 0.42, 0.45)
	mat.roughness = 0.85
	for i in count:
		var x := rng.randf_range(-195, 195)
		var z := rng.randf_range(-195, 195)
		var y := height_at(x, z)
		if y < 0.2:
			continue
		var body := StaticBody3D.new()
		body.position = Vector3(x, y, z)
		body.collision_layer = 1
		body.collision_mask = 0
		body.rotation.y = rng.randf() * TAU
		add_child(body)
		var s := Vector3(rng.randf_range(1.5, 4.0), rng.randf_range(1.0, 2.6), rng.randf_range(1.5, 4.0))
		_add_box(body, s, Vector3(0, s.y * 0.35, 0), mat)

func _pick_spawn_points(count: int) -> void:
	var attempts := 0
	while spawn_points.size() < count and attempts < 3000:
		attempts += 1
		var x := rng.randf_range(-150, 150)
		var z := rng.randf_range(-150, 150)
		var y := height_at(x, z)
		if y < 1.0:
			continue
		# never drop anyone on top of a compound: the building floor sits above
		# the terrain, so a spawn inside the footprint lands under the plinth
		var clear := true
		for c in compound_centres:
			if Vector2(x, z).distance_to(c) < 34.0:
				clear = false
				break
		if not clear:
			continue
		# and keep spawns spread out so nobody lands in a fistfight
		for sp in spawn_points:
			if Vector2(sp.x, sp.z).distance_to(Vector2(x, z)) < 26.0:
				clear = false
				break
		if not clear:
			continue
		spawn_points.append(Vector3(x, y + 2.0, z))

	# fall back to a ring if the rejection sampling came up short
	var i := 0
	while spawn_points.size() < count:
		var a := float(i) * 0.7
		var x := cos(a) * 120.0
		var z := sin(a) * 120.0
		spawn_points.append(Vector3(x, maxf(height_at(x, z), 1.0) + 2.0, z))
		i += 1
