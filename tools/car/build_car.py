"""Builds the original Sumo GT coupe and exports it as public/models/sumo-gt.glb.

Run headless from anywhere:

    /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/car/build_car.py

Add turntable renders (written to docs/screenshots/car-blender-*.png):

    /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/car/build_car.py -- --render

The design is original: a long-bonnet fastback GT with fender peaks, a ducktail, a full-width
tail light and slim LED headlights. No real car brand, badge or third-party model is used.

Coordinates in this file are written in game space (metres, +Y up, the car faces +Z) and
converted to Blender space by `bl()`. The glTF exporter converts back to +Y up on export.
The chassis origin, ground height and wheel positions match src/game/physics.ts at rest.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUTPUT_GLB = os.path.join(REPO_ROOT, "public", "models", "sumo-gt.glb")
SCREENSHOT_DIR = os.path.join(REPO_ROOT, "docs", "screenshots")

# Physics at rest: chassis origin 0.603 m above the ground, wheel hubs 0.243 m below it.
GROUND_Y = -0.603
HUB_Y = -0.243
TRACK_X = 0.89
FRONT_AXLE_Z = 1.42
REAR_AXLE_Z = -1.38
TYRE_RADIUS = 0.36
ARCH_RADIUS = 0.405

FRONT_Z = 2.20
REAR_Z = -2.16
WINDSCREEN_BASE_Z = 0.86
ROOF_FRONT_Z = 0.02
ROOF_REAR_Z = -0.70
FASTBACK_END_Z = -1.80


def bl(x, y, z):
    """Game space (x, up, forward) to Blender space (x, -forward, up)."""
    return Vector((x, -z, y))


def lerp(a, b, t):
    return a + (b - a) * t


def monotone_curve(keys):
    """Monotone cubic (Fritsch-Carlson) through (z, value) keys; clamps outside the range."""
    xs = [k[0] for k in keys]
    ys = [k[1] for k in keys]
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0] = d[0]
    m[-1] = d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def evaluate(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        t = (x - xs[i]) / h[i]
        t2 = t * t
        t3 = t2 * t
        return (
            (2 * t3 - 3 * t2 + 1) * ys[i]
            + (t3 - 2 * t2 + t) * h[i] * m[i]
            + (-2 * t3 + 3 * t2) * ys[i + 1]
            + (t3 - t2) * h[i] * m[i + 1]
        )

    return evaluate


# ------------------------------------------------------------------ Body shape

HALF_WIDTH = monotone_curve([
    (-2.16, 0.80), (-2.00, 0.90), (-1.70, 0.975), (-1.38, 1.00), (-1.00, 0.965),
    (-0.40, 0.93), (0.40, 0.93), (1.00, 0.95), (1.42, 0.985), (1.85, 0.95),
    (2.08, 0.87), (2.20, 0.75),
])
BOTTOM = monotone_curve([
    (-2.16, -0.36), (-1.95, -0.45), (-1.60, -0.475), (1.70, -0.475), (2.05, -0.46),
    (2.20, -0.40),
])
BELT = monotone_curve([
    (-2.16, 0.10), (-2.00, 0.18), (-1.60, 0.225), (-1.38, 0.235), (-0.90, 0.17),
    (-0.20, 0.135), (0.50, 0.135), (1.00, 0.18), (1.42, 0.21), (1.80, 0.15),
    (2.05, 0.04), (2.20, -0.10),
])
TOP_CENTRE = monotone_curve([
    (-2.16, 0.10), (-2.03, 0.185), (-1.85, 0.17), (-1.50, 0.16), (0.00, 0.16),
    (0.80, 0.16), (1.20, 0.145), (1.60, 0.11), (2.00, 0.02), (2.20, -0.10),
])
ROOF = monotone_curve([
    (-1.90, 0.60), (-0.70, 0.637), (-0.35, 0.648), (0.05, 0.635), (0.90, 0.60),
])
WINDOW_BASE_HALF = monotone_curve([(-1.90, 0.74), (-1.20, 0.80), (0.00, 0.80), (0.90, 0.78)])
ROOF_HALF = monotone_curve([(-1.90, 0.50), (-0.70, 0.60), (0.00, 0.60), (0.90, 0.55)])


def cabin_factor(z):
    """0 where the bonnet or deck is the top surface, 1 under the full-height roof."""
    if z >= WINDSCREEN_BASE_Z or z <= FASTBACK_END_Z:
        return 0.0
    if z >= ROOF_FRONT_Z:
        u = (z - ROOF_FRONT_Z) / (WINDSCREEN_BASE_Z - ROOF_FRONT_Z)
        return 1.0 - u ** 1.15
    if z >= ROOF_REAR_Z:
        return 1.0
    # A convex fastback: gentle near the roof, steeper towards the tail.
    u = (ROOF_REAR_Z - z) / (ROOF_REAR_Z - FASTBACK_END_Z)
    return 1.0 - u ** 1.6


def half_profile(z):
    """Ten (x, y) points from the bottom centre round the right side to the top centre."""
    w = HALF_WIDTH(z)
    yb = BOTTOM(z)
    belt = BELT(z)
    top = TOP_CENTRE(z)
    c = cabin_factor(z)
    roof = ROOF(z)
    side = belt - yb

    lower = [
        (0.0, yb),
        (w - 0.14, yb),
        (w - 0.04, yb + 0.06),
        (w, yb + 0.45 * side),
        (w - 0.012, yb + 0.78 * side),
        (w - 0.06, belt),
    ]
    bonnet = [
        (w - 0.17, lerp(belt, top, 0.30)),
        (0.62 * w, lerp(belt, top, 0.78)),
        (0.30 * w, top + 0.008),
        (0.0, top),
    ]
    base = WINDOW_BASE_HALF(z)
    roof_half = ROOF_HALF(z)
    cabin = [
        (base, belt + 0.03),
        (roof_half, roof - 0.075),
        (0.52 * roof_half, roof - 0.018),
        (0.0, roof),
    ]
    upper = [(lerp(b[0], g[0], c), lerp(b[1], g[1], c)) for b, g in zip(bonnet, cabin)]
    return lower + upper


def full_loop(z):
    half = half_profile(z)
    right = [(x, y) for x, y in half]
    left = [(-x, y) for x, y in reversed(half[1:-1])]
    return right + left


def column_of(edge_index):
    """Maps a loop edge index (0..17) to its half-profile column (0..8)."""
    return edge_index if edge_index <= 8 else 17 - edge_index


def span_material(column, z0, z1):
    c0 = cabin_factor(z0)
    c1 = cabin_factor(z1)
    c_mid = 0.5 * (c0 + c1)
    z_mid = 0.5 * (z0 + z1)
    full_roof = min(c0, c1) > 0.999
    if column == 0:
        return "trim"
    if column <= 5:
        return "body"
    if column == 6:
        if full_roof:
            return "glass"
        if z_mid > 0 and c_mid > 0.2:
            return "trim"
        if z_mid < 0 and c_mid > 0.78:
            return "glass"
        return "body"
    if full_roof:
        return "body"
    if z_mid > 0 and c_mid > 0.03:
        return "glass"
    if z_mid < 0 and c_mid > 0.28:
        return "glass"
    return "body"


def stations():
    count = 46
    values = [REAR_Z + (FRONT_Z - REAR_Z) * i / (count - 1) for i in range(count)]
    for extra in (ROOF_FRONT_Z, ROOF_REAR_Z, WINDSCREEN_BASE_Z, FASTBACK_END_Z):
        values = [v for v in values if abs(v - extra) > 0.035] + [extra]
    return sorted(values)


# ------------------------------------------------------------------ Materials

MATERIALS = {}


def make_material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0,
                  alpha=1.0, coat=0.0):
    material = bpy.data.materials.new(name)
    bsdf = material.node_tree.nodes["Principled BSDF"]
    rgba = (*color, 1.0)
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.05
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        material.surface_render_method = "BLENDED"
    MATERIALS[name] = material
    return material


def srgb(hex_value):
    """Hex sRGB colour to linear RGB, as Blender colour sockets expect."""
    def channel(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(channel(int(hex_value[i:i + 2], 16)) for i in (1, 3, 5))


def create_materials():
    make_material("body", srgb("#1b4a6b"), metallic=0.8, roughness=0.32, coat=1.0)
    make_material("glass", srgb("#0b1620"), metallic=0.0, roughness=0.05, alpha=0.55)
    make_material("trim", srgb("#0b0d10"), metallic=0.3, roughness=0.45)
    make_material("chrome", srgb("#c9d1d8"), metallic=1.0, roughness=0.12)
    make_material("interior", srgb("#14161a"), metallic=0.0, roughness=0.8)
    make_material("lights_front", srgb("#e8fbff"), emission=srgb("#c4f6ff"), strength=8.0)
    make_material("lights_rear", srgb("#ff1a3d"), emission=srgb("#ff1a3d"), strength=4.0)
    make_material("lights_reverse", srgb("#f2f5f8"), emission=srgb("#f2f5f8"), strength=0.0)
    make_material("tyre", srgb("#0c0d0f"), metallic=0.0, roughness=0.85)
    make_material("rim", srgb("#3b4148"), metallic=1.0, roughness=0.28)
    make_material("disc", srgb("#6d7176"), metallic=1.0, roughness=0.45)
    make_material("caliper", srgb("#ffb21e"), metallic=0.1, roughness=0.35, coat=0.6)


# ------------------------------------------------------------------ Mesh helpers

def new_object(name, bm, material_names, parent=None):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for material_name in material_names:
        mesh.materials.append(MATERIALS[material_name])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def mark_sharp_edges(obj, angle_degrees=38.0):
    """Smooth shading everywhere except creases sharper than the given angle."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    limit = math.radians(angle_degrees)
    for face in bm.faces:
        face.smooth = True
    for edge in bm.edges:
        edge.smooth = not (edge.is_manifold and edge.calc_face_angle(0.0) > limit)
        if not edge.is_manifold:
            edge.smooth = False
    bm.to_mesh(obj.data)
    bm.free()


def join(objects, name):
    target = objects[0]
    with bpy.context.temp_override(
        active_object=target,
        selected_objects=objects,
        selected_editable_objects=objects,
    ):
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def apply_modifiers(obj):
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj]):
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)


def cylinder_x(bm, x0, x1, radius, centre_y, centre_z, segments=32):
    """Adds a capped cylinder along the game X axis to `bm` (game-space centre)."""
    depth = x1 - x0
    centre = bl((x0 + x1) / 2, centre_y, centre_z)
    matrix = Matrix.Translation(centre) @ Matrix.Rotation(math.radians(90), 4, "Y")
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius, depth=depth, matrix=matrix,
    )


def cylinder_z(bm, z0, z1, radius, x, y, segments=24):
    """Adds a capped cylinder along the game Z (forward) axis."""
    depth = abs(z1 - z0)
    centre = bl(x, y, (z0 + z1) / 2)
    matrix = Matrix.Translation(centre) @ Matrix.Rotation(math.radians(90), 4, "X")
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius, depth=depth, matrix=matrix,
    )


def box(bm, centre, size, rotation=None):
    """Adds a box given a game-space centre and (x, y, z) size, optionally rotated."""
    matrix = Matrix.Translation(bl(*centre))
    if rotation is not None:
        matrix = matrix @ rotation
    matrix = matrix @ Matrix.Diagonal((size[0], size[2], size[1], 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=matrix)


# ------------------------------------------------------------------ Body shell

def build_shell():
    order = ["body", "glass", "trim"]
    bm = bmesh.new()
    zs = stations()
    loops = []
    for z in zs:
        loops.append([bm.verts.new(bl(x, y, z)) for x, y in full_loop(z)])

    count = len(loops[0])
    for i in range(len(loops) - 1):
        for j in range(count):
            k = (j + 1) % count
            face = bm.faces.new((loops[i][j], loops[i][k], loops[i + 1][k], loops[i + 1][j]))
            face.material_index = order.index(span_material(column_of(j), zs[i], zs[i + 1]))

    # Rounded nose and tail: one shrunken loop beyond each end, then a poked cap.
    for end, z, scale, step in ((0, zs[0], 0.82, -0.03), (-1, zs[-1], 0.80, 0.03)):
        ring = loops[end]
        centre = sum((v.co for v in ring), Vector()) / len(ring)
        tip = []
        for v in ring:
            offset = (v.co - centre) * scale
            tip.append(bm.verts.new(centre + offset + Vector((0.0, -step, 0.0))))
        for j in range(count):
            k = (j + 1) % count
            face = bm.faces.new((ring[j], ring[k], tip[k], tip[j]))
            face.material_index = 0 if column_of(j) > 0 else 2
        cap = bm.faces.new(tip)
        cap.material_index = 0
        bmesh.ops.poke(bm, faces=[cap])

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shell = new_object("shell", bm, order)

    subsurf = shell.modifiers.new("smooth", "SUBSURF")
    subsurf.levels = 2
    subsurf.render_levels = 2

    cutter_bm = bmesh.new()
    for side in (-1, 1):
        for axle_z in (FRONT_AXLE_Z, REAR_AXLE_Z):
            x0, x1 = (0.66, 1.35) if side > 0 else (-1.35, -0.66)
            cylinder_x(cutter_bm, x0, x1, ARCH_RADIUS, HUB_Y, axle_z, segments=48)
    cutter = new_object("arch_cutter", cutter_bm, ["trim"])
    cutter.hide_render = True
    cutter.hide_viewport = True

    boolean = shell.modifiers.new("arches", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.solver = "EXACT"
    boolean.object = cutter
    boolean.material_mode = "TRANSFER"
    apply_modifiers(shell)
    bpy.data.objects.remove(cutter, do_unlink=True)
    mark_sharp_edges(shell)
    return shell


def add_body_uvs(obj, metres_per_tile=0.5):
    """Box-projected UVs so the runtime flake normal map has a consistent scale."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        n = face.normal
        axis = max(range(3), key=lambda a: abs(n[a]))
        u_axis, v_axis = [(1, 2), (0, 2), (0, 1)][axis]
        for loop in face.loops:
            co = loop.vert.co
            loop[uv_layer].uv = (co[u_axis] / metres_per_tile, co[v_axis] / metres_per_tile)
    bm.to_mesh(obj.data)
    bm.free()


def make_lod(shell, ratio):
    lod = shell.copy()
    lod.data = shell.data.copy()
    bpy.context.scene.collection.objects.link(lod)
    decimate = lod.modifiers.new("decimate", "DECIMATE")
    decimate.ratio = ratio
    apply_modifiers(lod)
    # The full-detail glass stays visible at every distance, so the LOD keeps no glass of its own.
    glass_index = [m.name for m in lod.data.materials].index("glass")
    bm = bmesh.new()
    bm.from_mesh(lod.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == glass_index],
                     context="FACES")
    bm.to_mesh(lod.data)
    bm.free()
    lod.data.materials.pop(index=glass_index)
    mark_sharp_edges(lod)
    lod.name = "body_lod1"
    lod.data.name = "body_lod1"
    return lod


def split_by_material(shell):
    """Separates the shell into one object per material, named after the material."""
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    with bpy.context.temp_override(
        active_object=shell, object=shell, selected_objects=[shell],
        selected_editable_objects=[shell],
    ):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="MATERIAL")
        bpy.ops.object.mode_set(mode="OBJECT")
    parts = {}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or not (obj == shell or obj.name.startswith("shell.")):
            continue
        used = {poly.material_index for poly in obj.data.polygons}
        name = obj.data.materials[used.pop()].name
        # Drop the unused slots so each part exports a single primitive.
        keep = MATERIALS[name]
        obj.data.materials.clear()
        obj.data.materials.append(keep)
        for poly in obj.data.polygons:
            poly.material_index = 0
        obj.name = name
        obj.data.name = name
        parts[name] = obj
    return parts


# ------------------------------------------------------------------ Surface details

class Surface:
    """Ray casts against the evaluated body so details sit on the curved panels."""

    def __init__(self, obj):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        self.tree = BVHTree.FromObject(obj, depsgraph)

    def hit(self, origin, target):
        """Casts from game-space `origin` towards game-space `target`."""
        start = bl(*origin)
        direction = (bl(*target) - start).normalized()
        location, normal, _, _ = self.tree.ray_cast(start, direction, 10.0)
        if location is None:
            raise RuntimeError(f"Detail ray from {origin} missed the body")
        if normal.dot(direction) > 0:
            normal = -normal
        return location, normal


def strip(bm, surface, samples, width, thickness, lift=0.002):
    """A box-section strip that follows the body through (origin, target) ray samples."""
    points = [surface.hit(origin, target) for origin, target in samples]
    sections = []
    for i, (location, normal) in enumerate(points):
        previous = points[max(0, i - 1)][0]
        following = points[min(len(points) - 1, i + 1)][0]
        tangent = (following - previous).normalized()
        across = normal.cross(tangent).normalized()
        base = location + normal * lift
        half = across * (width / 2)
        up = normal * thickness
        sections.append([
            bm.verts.new(base - half),
            bm.verts.new(base + half),
            bm.verts.new(base + half + up),
            bm.verts.new(base - half + up),
        ])
    for a, b in zip(sections, sections[1:]):
        for j in range(4):
            k = (j + 1) % 4
            bm.faces.new((a[j], a[k], b[k], b[j]))
    bm.faces.new(sections[0])
    bm.faces.new(list(reversed(sections[-1])))


def sweep_samples(centre, start_deg, end_deg, count, y_at, facing):
    """Rays aimed horizontally at `centre` from a fan of directions around it."""
    samples = []
    for i in range(count):
        u = i / (count - 1)
        angle = math.radians(lerp(start_deg, end_deg, u))
        y = y_at(u)
        direction = (math.sin(angle), facing * math.cos(angle))
        origin = (centre[0] + direction[0] * 3.0, y, centre[2] + direction[1] * 3.0)
        samples.append((origin, (centre[0], y, centre[2])))
    return samples


def build_lights(surface):
    front = bmesh.new()
    rear = bmesh.new()
    reverse = bmesh.new()
    housing = bmesh.new()

    nose = (0.0, 0.0, 1.55)
    for side in (-1, 1):
        start, end = (18, 60) if side > 0 else (-18, -60)
        led_y = lambda u: -0.150 + 0.055 * u * u
        housing_y = lambda u: -0.150 + 0.055 * u * u - 0.004
        strip(housing, surface, sweep_samples(nose, start, end, 14, housing_y, 1), 0.07, 0.006)
        strip(front, surface, sweep_samples(nose, start, end, 14, led_y, 1), 0.018, 0.012)
        # A short vertical daytime-running fang at the inner end of each lamp.
        inner = math.radians(start)
        fang = []
        for i in range(5):
            y = -0.17 - 0.07 * i / 4
            direction = (math.sin(inner), math.cos(inner))
            fang.append(((nose[0] + direction[0] * 3.0, y, nose[2] + direction[1] * 3.0),
                         (nose[0], y, nose[2])))
        strip(front, surface, fang, 0.014, 0.012)

    tail = (0.0, 0.0, -1.45)
    strip(housing, surface, sweep_samples(tail, -64, 64, 33, lambda u: 0.085, -1), 0.085, 0.006)
    strip(rear, surface, sweep_samples(tail, -64, 64, 33, lambda u: 0.09, -1), 0.03, 0.012)
    for side in (-1, 1):
        a, b = (9, 22) if side > 0 else (-9, -22)
        strip(reverse, surface, sweep_samples(tail, a, b, 5, lambda u: -0.215, -1), 0.03, 0.012)

    return front, rear, reverse, housing


def build_trim(surface):
    trim = bmesh.new()
    chrome = bmesh.new()

    # Lower front intake with two bright slats.
    intake = (0.0, 0.0, 1.5)
    strip(trim, surface, sweep_samples(intake, -42, 42, 23, lambda u: -0.31, 1), 0.13, 0.008)
    for y in (-0.285, -0.335):
        strip(chrome, surface, sweep_samples(intake, -40, 40, 21, lambda u: y, 1), 0.007, 0.014)

    # Side skirts.
    for side in (-1, 1):
        samples = []
        for i in range(17):
            z = lerp(-0.92, 0.98, i / 16)
            samples.append(((side * 3.0, -0.415, z), (0.0, -0.415, z)))
        strip(trim, surface, samples, 0.06, 0.012)

    # Rear diffuser band, vertical fins and twin exhausts.
    tail = (0.0, 0.0, -1.45)
    strip(trim, surface, sweep_samples(tail, -48, 48, 25, lambda u: -0.33, -1), 0.11, 0.008)
    for x in (-0.30, -0.10, 0.10, 0.30):
        box(trim, (x, -0.40, -1.98), (0.012, 0.08, 0.24))
    for x in (-0.46, 0.46):
        location, _ = surface.hit((x, -0.30, -4.0), (x, -0.30, 0.0))
        rear_face = -location.y
        cylinder_z(chrome, rear_face - 0.10, rear_face - 0.035, 0.048, x, -0.30)
        cylinder_z(trim, rear_face - 0.09, rear_face - 0.03, 0.038, x, -0.30)

    # Twin bonnet vents following the bonnet crown.
    for side in (-1, 1):
        samples = []
        for i in range(9):
            z = lerp(0.98, 1.30, i / 8)
            x = side * lerp(0.30, 0.34, i / 8)
            samples.append(((x, 3.0, z), (x, -1.0, z)))
        strip(trim, surface, samples, 0.045, 0.006)

    # Door mirrors on short stalks.
    for side in (-1, 1):
        box(trim, (side * 0.86, 0.205, 0.62), (0.12, 0.025, 0.05))
    return trim, chrome


def build_mirror_shells():
    bm = bmesh.new()
    for side in (-1, 1):
        matrix = (
            Matrix.Translation(bl(side * 0.935, 0.24, 0.60))
            @ Matrix.Diagonal((0.075, 0.115, 0.058, 1.0))
        )
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0, matrix=matrix)
    return bm


def build_interior():
    bm = bmesh.new()
    box(bm, (0.0, -0.15, -0.12), (1.44, 0.48, 1.36))
    box(bm, (0.0, 0.17, 0.38), (1.20, 0.13, 0.24))
    for x in (-0.34, 0.34):
        box(bm, (x, 0.15, -0.20), (0.42, 0.08, 0.48))
        tilt = Matrix.Rotation(math.radians(-16), 4, "X")
        box(bm, (x, 0.32, -0.46), (0.40, 0.36, 0.09), tilt)
    wheel = (
        Matrix.Translation(bl(0.34, 0.29, 0.22))
        @ Matrix.Rotation(math.radians(70), 4, "X")
    )
    bmesh.ops.create_circle(bm, cap_ends=True, segments=20, radius=0.15, matrix=wheel)
    return bm


# ------------------------------------------------------------------ Wheels

def lathe(bm, profile, steps=48):
    """Revolves a closed (x, radius) profile around the axle (Blender X axis)."""
    verts = [bm.verts.new((x, 0.0, r)) for x, r in profile]
    edges = [bm.edges.new((verts[i], verts[(i + 1) % len(verts)])) for i in range(len(verts))]
    bmesh.ops.spin(
        bm, geom=verts + edges, cent=(0, 0, 0), axis=(1, 0, 0),
        angle=math.tau, steps=steps, use_merge=True,
    )


def radial_block(bm, angle, r0, r1, half_width0, half_width1, x0_in, x0_out, x1_in, x1_out,
                 twist=0.0):
    """A tapered spoke from radius r0 to r1 around the axle at `angle` (Blender YZ plane)."""
    def point(r, tangent_offset, x, extra_angle):
        a = angle + extra_angle
        radial = Vector((0.0, math.cos(a), math.sin(a)))
        tangent = Vector((0.0, -math.sin(a), math.cos(a)))
        return Vector((x, 0.0, 0.0)) + radial * r + tangent * tangent_offset

    v = [
        bm.verts.new(point(r0, -half_width0, x0_in, 0.0)),
        bm.verts.new(point(r0, half_width0, x0_in, 0.0)),
        bm.verts.new(point(r1, half_width1, x1_in, twist)),
        bm.verts.new(point(r1, -half_width1, x1_in, twist)),
        bm.verts.new(point(r0, -half_width0, x0_out, 0.0)),
        bm.verts.new(point(r0, half_width0, x0_out, 0.0)),
        bm.verts.new(point(r1, half_width1, x1_out, twist)),
        bm.verts.new(point(r1, -half_width1, x1_out, twist)),
    ]
    for face in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3),
                 (3, 7, 4, 0)):
        bm.faces.new([v[i] for i in face])


def axle_cylinder(bm, x0, x1, radius, segments, offset=(0.0, 0.0)):
    matrix = (
        Matrix.Translation(Vector(((x0 + x1) / 2, offset[0], offset[1])))
        @ Matrix.Rotation(math.radians(90), 4, "Y")
    )
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius, depth=x1 - x0, matrix=matrix,
    )


def build_wheel_mesh():
    """One wheel facing +X (outboard), origin at the hub. Mirrored for the other side."""
    parts = []

    tyre = bmesh.new()
    lathe(tyre, [
        (-0.112, 0.250), (-0.121, 0.300), (-0.118, 0.343), (-0.098, 0.360),
        (-0.05, 0.360), (-0.04, 0.353), (-0.03, 0.360), (0.03, 0.360), (0.04, 0.353),
        (0.05, 0.360), (0.098, 0.360), (0.118, 0.343), (0.121, 0.300), (0.112, 0.250),
    ], steps=56)
    parts.append(new_object("tyre_part", tyre, ["tyre"]))

    rim = bmesh.new()
    lathe(rim, [
        (0.085, 0.215), (0.112, 0.243), (0.118, 0.252), (0.104, 0.256), (0.090, 0.246),
        (0.060, 0.212), (-0.100, 0.205), (-0.112, 0.247), (-0.100, 0.247), (-0.090, 0.198),
        (0.050, 0.200),
    ], steps=48)
    for i in range(5):
        base = math.tau * i / 5
        for offset in (-0.10, 0.10):
            radial_block(rim, base + offset, 0.062, 0.212, 0.019, 0.012,
                         0.050, 0.078, 0.066, 0.094, twist=0.10)
    axle_cylinder(rim, 0.04, 0.09, 0.068, 24)
    parts.append(new_object("rim_part", rim, ["rim"]))

    nuts = bmesh.new()
    for i in range(5):
        a = math.tau * (i + 0.5) / 5
        axle_cylinder(nuts, 0.088, 0.100, 0.011, 8, (math.cos(a) * 0.045, math.sin(a) * 0.045))
    axle_cylinder(nuts, 0.088, 0.103, 0.026, 16)
    parts.append(new_object("nut_part", nuts, ["chrome"]))

    disc = bmesh.new()
    axle_cylinder(disc, -0.024, 0.0, 0.18, 32)
    axle_cylinder(disc, 0.0, 0.042, 0.092, 20)
    parts.append(new_object("disc_part", disc, ["disc"]))

    return join(parts, "wheel")


def build_caliper_mesh():
    """A four-piston style caliper behind the top of the disc; origin at the hub."""
    bm = bmesh.new()
    start = math.radians(30.0)
    profile = [(-0.058, 0.125), (0.032, 0.125), (0.032, 0.192), (-0.058, 0.192)]
    rotation = Matrix.Rotation(start, 3, "X")
    verts = [bm.verts.new(rotation @ Vector((x, 0.0, r))) for x, r in profile]
    face = bm.faces.new(verts)
    bmesh.ops.spin(
        bm, geom=[face, *verts, *face.edges], cent=(0, 0, 0), axis=(1, 0, 0),
        angle=math.radians(52.0), steps=6, use_duplicate=False,
    )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object("caliper", bm, ["caliper"])


# ------------------------------------------------------------------ Assembly

def place(obj, game_position, mirrored, parent):
    obj.location = bl(*game_position)
    if mirrored:
        obj.scale = (-1.0, 1.0, 1.0)
    obj.parent = parent


def build_car():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    create_materials()
    root = bpy.data.objects.new("sumo_gt", None)
    bpy.context.scene.collection.objects.link(root)

    shell = build_shell()
    lod = make_lod(shell, 0.2)
    surface = Surface(shell)

    front, rear, reverse, housing = build_lights(surface)
    trim_bm, chrome_bm = build_trim(surface)
    mirrors = new_object("mirrors", build_mirror_shells(), ["body"])
    mark_sharp_edges(mirrors, 80.0)

    parts = split_by_material(shell)
    body = join([parts["body"], mirrors], "body")
    add_body_uvs(body)

    trim = join([
        parts["trim"],
        new_object("housing", housing, ["trim"]),
        new_object("trim_details", trim_bm, ["trim"]),
        new_object("chrome_details", chrome_bm, ["chrome"]),
    ], "trim")

    pieces = [
        body,
        parts["glass"],
        trim,
        lod,
        new_object("interior", build_interior(), ["interior"]),
        new_object("lights_front", front, ["lights_front"]),
        new_object("lights_rear", rear, ["lights_rear"]),
        new_object("lights_reverse", reverse, ["lights_reverse"]),
    ]
    for piece in pieces:
        piece.parent = root
        if piece.name.startswith("lights") or piece.name == "interior":
            mark_sharp_edges(piece, 30.0)

    wheel = build_wheel_mesh()
    mark_sharp_edges(wheel, 35.0)
    caliper = build_caliper_mesh()
    mark_sharp_edges(caliper, 35.0)

    corners = {
        "fl": (TRACK_X, FRONT_AXLE_Z, False),
        "fr": (-TRACK_X, FRONT_AXLE_Z, True),
        "rl": (TRACK_X, REAR_AXLE_Z, False),
        "rr": (-TRACK_X, REAR_AXLE_Z, True),
    }
    for key, (x, z, mirrored) in corners.items():
        wheel_obj = wheel if key == "fl" else bpy.data.objects.new("w", wheel.data)
        caliper_obj = caliper if key == "fl" else bpy.data.objects.new("c", caliper.data)
        for obj, prefix in ((wheel_obj, "wheel"), (caliper_obj, "caliper")):
            if obj.name not in bpy.context.scene.collection.objects:
                bpy.context.scene.collection.objects.link(obj)
            obj.name = f"{prefix}_{key}"
            place(obj, (x, HUB_Y, z), mirrored, root)
    return root


def export_glb():
    os.makedirs(os.path.dirname(OUTPUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_GLB,
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
    )
    size = os.path.getsize(OUTPUT_GLB)
    triangles = 0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
    print(f"SUMO-GT exported {OUTPUT_GLB} ({size / 1024:.0f} KiB, {triangles} triangles in scene)")


# ------------------------------------------------------------------ Turntable renders

def studio():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = 48
    scene.eevee.use_raytracing = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"

    world = bpy.data.worlds.new("studio")
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.016, 0.024, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world

    floor_bm = bmesh.new()
    bmesh.ops.create_grid(floor_bm, x_segments=1, y_segments=1, size=30.0,
                          matrix=Matrix.Translation((0, 0, GROUND_Y)))
    floor_material = bpy.data.materials.new("floor")
    floor_bsdf = floor_material.node_tree.nodes["Principled BSDF"]
    floor_bsdf.inputs["Base Color"].default_value = (0.02, 0.022, 0.026, 1)
    floor_bsdf.inputs["Roughness"].default_value = 0.25
    MATERIALS["floor"] = floor_material
    new_object("floor", floor_bm, ["floor"])

    def area(name, location, rotation, size, energy, color):
        data = bpy.data.lights.new(name, "AREA")
        data.shape = "RECTANGLE"
        data.size = size[0]
        data.size_y = size[1]
        data.energy = energy
        data.color = color
        light = bpy.data.objects.new(name, data)
        light.location = location
        light.rotation_euler = rotation
        scene.collection.objects.link(light)

    area("key", (0, 0, 4.2), (0, 0, 0), (3.0, 6.0), 1400, (1.0, 0.97, 0.94))
    area("cyan", (-4.5, -2.0, 1.4), (math.radians(80), 0, math.radians(-65)), (2.0, 3.0), 700,
         (0.35, 0.9, 1.0))
    area("magenta", (4.5, 2.5, 1.4), (math.radians(80), 0, math.radians(115)), (2.0, 3.0), 650,
         (1.0, 0.3, 0.7))

    camera_data = bpy.data.cameras.new("camera")
    camera_data.lens = 50
    camera = bpy.data.objects.new("camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    target = bpy.data.objects.new("target", None)
    target.location = (0, 0, 0.0)
    scene.collection.objects.link(target)
    constraint = camera.constraints.new("TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    return camera


def render_turntable():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    # Render the close-up detail level only; the decimated shell overlaps it.
    bpy.data.objects["body_lod1"].hide_render = True
    camera = studio()
    views = {
        "front34": (35, 1.6),
        "side": (90, 0.9),
        "rear34": (150, 1.7),
        "front": (0, 1.2),
    }
    for name, (azimuth_deg, height) in views.items():
        # Azimuth is measured from the car's nose (game +Z, Blender -Y) towards its left.
        a = math.radians(azimuth_deg)
        distance = 7.4
        camera.location = (math.sin(a) * distance, -math.cos(a) * distance, height)
        bpy.context.scene.render.filepath = os.path.join(SCREENSHOT_DIR, f"car-blender-{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"SUMO-GT rendered {name}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    build_car()
    export_glb()
    if "--render" in argv:
        render_turntable()


main()
