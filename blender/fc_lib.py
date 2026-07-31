r"""Shared Blender build kit for the Frontline Command sets.

Geometry helpers, world-position procedural materials, lights and render setup,
factored out of the armory bay build so every set starts from the same proven
code. Scene scripts do:

    import sys, importlib
    sys.path.append(r"H:\sbAPPS\BattleJava2\blender")
    import fc_lib; importlib.reload(fc_lib)
    from fc_lib import *

The reload matters — without it Blender keeps the first import for the whole
session and edits to this file are silently ignored.

Two conventions everything here depends on:
  * box() bakes size into the mesh, leaving object scale at 1. Carrying size in
    the scale distorts bevel widths per axis and scales array offsets.
  * arr() takes a WORLD axis and rotates it into the object's frame, because
    Blender applies an array's constant offset in local space.
"""
import bpy, bmesh, math, random
from mathutils import Vector

TAU = math.tau
R = math.radians


# ------------------------------------------------------------------ scene io

def wipe():
    # module-level state survives between runs now that this is a module,
    # so the collection cache has to be dropped alongside the datablocks
    COLLS.clear()
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                  bpy.data.cameras, bpy.data.curves, bpy.data.node_groups):
        for d in list(block):
            block.remove(d)


COLLS = {}

def coll(name):
    if name not in COLLS:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COLLS[name] = c
    return COLLS[name]


# ------------------------------------------------------------------ geometry

UNIT_V = [(-.5, -.5, -.5), (.5, -.5, -.5), (.5, .5, -.5), (-.5, .5, -.5),
          (-.5, -.5, .5), (.5, -.5, .5), (.5, .5, .5), (-.5, .5, .5)]
# face order: -Z, +Z, -Y, +X, +Y, -X
UNIT_F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
          (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def _obj(name, me, group, mats):
    ob = bpy.data.objects.new(name, me)
    coll(group).objects.link(ob)
    if mats:
        for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
            ob.data.materials.append(m)
    return ob


def bevel(ob, width=0.012, segments=2, angle=50.0):
    if width <= 0:
        return ob
    m = ob.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = R(angle)
    m.harden_normals = segments > 1
    ob.data.polygons.foreach_set('use_smooth', [True] * len(ob.data.polygons))
    ob.data.update()
    return ob


def box(name, size, loc, rot=(0, 0, 0), mats=None, face_mats=None,
        group='Shell', bev=0.012, segs=2):
    """Size is baked into the mesh so object scale stays 1 — otherwise bevel
    widths and array offsets get scaled per axis."""
    verts = [(v[0] * size[0], v[1] * size[1], v[2] * size[2]) for v in UNIT_V]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], UNIT_F)
    me.update()
    if face_mats:
        for i, p in enumerate(me.polygons):
            p.material_index = face_mats[i]
    ob = _obj(name, me, group, mats)
    ob.location = loc
    ob.rotation_euler = rot
    bevel(ob, bev, segs)
    return ob


def cyl(name, radius, depth, loc, rot=(0, 0, 0), verts=16, mats=None,
        group='Shell', bev=0.0, caps=True):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=verts,
                          radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = _obj(name, me, group, mats)
    ob.location = loc
    ob.rotation_euler = rot
    for p in ob.data.polygons:
        p.use_smooth = True
    bevel(ob, bev, 2)
    return ob


def band(name, inner, outer, y_in, y_out, mats=None, group='Shell',
         thickness=0.10, bev=0.02):
    """Mitred flare: rectangle `inner` at y_in flaring out to `outer` at y_out."""
    ix0, ix1, iz0, iz1 = inner
    ox0, ox1, oz0, oz1 = outer
    vi = [(ix0, y_in, iz0), (ix1, y_in, iz0), (ix1, y_in, iz1), (ix0, y_in, iz1)]
    vo = [(ox0, y_out, oz0), (ox1, y_out, oz0), (ox1, y_out, oz1), (ox0, y_out, oz1)]
    verts = vi + vo
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = _obj(name, me, group, mats)
    s = ob.modifiers.new('sol', 'SOLIDIFY')
    s.thickness = thickness
    s.offset = 1.0
    bevel(ob, bev, 2)
    return ob


def chamfer_rect(w, d, ch=(0, 0, 0, 0), cx=0.0, cy=0.0, floor=0.004):
    """A rectangle in XY with 45-degree cuts taken off named corners.

    Corners run counter-clockwise viewed from +Z, starting at (+x,-y):
        0 = +x-y,  1 = +x+y,  2 = -x+y,  3 = -x-y
    Always returns 8 points, so profiles with different chamfer sizes can still
    be lofted to one another — hence `floor`, a minimum cut that keeps a
    "square" corner from collapsing two points onto each other.
    """
    x0, x1 = cx - w * .5, cx + w * .5
    y0, y1 = cy - d * .5, cy + d * .5
    corners = [((x1, y0), (1, 0), (0, 1)),
               ((x1, y1), (0, 1), (-1, 0)),
               ((x0, y1), (-1, 0), (0, -1)),
               ((x0, y0), (0, -1), (1, 0))]
    pts = []
    for (p, ind, outd), c in zip(corners, ch):
        c = max(c, floor)
        pts.append((p[0] - ind[0] * c, p[1] - ind[1] * c))
        pts.append((p[0] + outd[0] * c, p[1] + outd[1] * c))
    return pts


def _prism_mesh(name, rings, zs, cap_bottom=True, cap_top=True):
    n = len(rings[0])
    verts, faces = [], []
    for ring, z in zip(rings, zs):
        verts.extend([(p[0], p[1], z) for p in ring])
    for k in range(len(rings) - 1):
        a, b = k * n, (k + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
    if cap_bottom:
        faces.append(tuple(range(n))[::-1])
    if cap_top:
        off = (len(rings) - 1) * n
        faces.append(tuple(range(off, off + n)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def prism_xz(name, pts, y0, y1, mats=None, group='Shell', bev=0.010, segs=2):
    """Extrude a closed profile drawn in the XZ plane along Y.

    For anything authored face-on to the camera: portal frames, the U-shaped
    surround of an opening, corner fill wedges. Profiles may be concave — a
    frame is just a rectangle that walks back in through its own opening — so
    normals are recalculated rather than assumed from winding.
    """
    n = len(pts)
    verts = [(p[0], y0, p[1]) for p in pts] + [(p[0], y1, p[1]) for p in pts]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))[::-1]]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = _obj(name, me, group, mats)
    bevel(ob, bev, segs, angle=25.0)
    return ob


def prism(name, pts, z0, z1, mats=None, group='Shell', bev=0.010, segs=2):
    """Extrude a closed XY profile between two heights."""
    ob = _obj(name, _prism_mesh(name, [pts, pts], [z0, z1]), group, mats)
    bevel(ob, bev, segs, angle=25.0)
    return ob


def loft(name, rings, zs, mats=None, group='Shell', bev=0.010, segs=2):
    """Stack profiles of equal point count — flared feet, collars, knees."""
    ob = _obj(name, _prism_mesh(name, rings, zs), group, mats)
    bevel(ob, bev, segs, angle=25.0)
    return ob


def arr(ob, count, offset, axis=0):
    """Array along a WORLD axis. Constant offset is a local-space vector, so
    rotate the requested world direction back into the object's frame."""
    v = Vector((0.0, 0.0, 0.0))
    v[axis] = offset
    v = ob.rotation_euler.to_matrix().inverted() @ v
    s = ob.scale
    v = Vector((v.x / s.x, v.y / s.y, v.z / s.z))
    m = ob.modifiers.new('arr%d' % axis, 'ARRAY')
    m.count = count
    m.use_relative_offset = False
    m.use_constant_offset = True
    m.constant_offset_displace = v
    return m


def ibeam(name, length, h=0.42, w=0.30, t=0.055, loc=(0, 0, 0), rot=(0, 0, 0),
          mats=None, group='Upper'):
    """I-beam running along local X."""
    parts = []
    parts.append(box(name + '_web', (length, t, h - 2 * t), (0, 0, 0),
                     mats=mats, group=group, bev=0.008))
    parts.append(box(name + '_ft', (length, w, t), (0, 0, (h - t) * .5),
                     mats=mats, group=group, bev=0.008))
    parts.append(box(name + '_fb', (length, w, t), (0, 0, -(h - t) * .5),
                     mats=mats, group=group, bev=0.008))
    root = bpy.data.objects.new(name, None)
    coll(group).objects.link(root)
    root.location = loc
    root.rotation_euler = rot
    root.empty_display_size = 0.2
    for p in parts:
        p.parent = root
    return root


# ------------------------------------------------------------------- shading

def sock(node, name, typ, out=False):
    for s in (node.outputs if out else node.inputs):
        if s.name == name and s.type == typ:
            return s
    return (node.outputs if out else node.inputs)[name]


def N(nt, kind, x=0, y=0, **props):
    n = nt.nodes.new(kind)
    n.location = (x, y)
    for k, v in props.items():
        if hasattr(n, k):
            setattr(n, k, v)
        else:
            n.inputs[k].default_value = v
    return n


def L(nt, a, ao, b, bi):
    """Link node->node, and tolerate a socket being handed in on either side."""
    src = a if isinstance(a, bpy.types.NodeSocket) else a.outputs[ao]
    dst = b if isinstance(b, bpy.types.NodeSocket) else b.inputs[bi]
    nt.links.new(src, dst)


def mixrgb(nt, x, y, fac, a, b):
    n = N(nt, 'ShaderNodeMix', x, y, data_type='RGBA', blend_type='MIX')
    n.inputs[0].default_value = fac
    sock(n, 'A', 'RGBA').default_value = (*a, 1) if len(a) == 3 else a
    sock(n, 'B', 'RGBA').default_value = (*b, 1) if len(b) == 3 else b
    return n


def m_out(node):
    return sock(node, 'Result', 'RGBA', out=True)


def math_n(nt, op, x, y, a=None, b=None):
    n = N(nt, 'ShaderNodeMath', x, y, operation=op)
    if a is not None:
        n.inputs[0].default_value = a
    if b is not None:
        n.inputs[1].default_value = b
    return n


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = N(nt, 'ShaderNodeOutputMaterial', 1400, 0)
    bsdf = N(nt, 'ShaderNodeBsdfPrincipled', 1000, 0)
    L(nt, bsdf, 'BSDF', out, 'Surface')
    return m, nt, bsdf


def worldpos(nt, x=-2200, y=0, scale=1.0):
    g = N(nt, 'ShaderNodeNewGeometry', x, y)
    return g


def metal(name, color=(0.040, 0.045, 0.055), rough=0.46, metallic=1.0,
          wear=0.45, wear_color=(0.28, 0.29, 0.31), micro=0.055,
          mottle=1.0, tex_scale=1.0):
    """Painted / bare steel driven entirely by world position — no UVs."""
    m, nt, bsdf = new_mat(name)
    geo = worldpos(nt)

    scl = N(nt, 'ShaderNodeVectorMath', -2000, -200, operation='SCALE')
    L(nt, geo, 'Position', scl, 0)
    scl.inputs['Scale'].default_value = tex_scale

    n_big = N(nt, 'ShaderNodeTexNoise', -1750, 250, Scale=0.55, Detail=6.0,
              Roughness=0.6)
    n_mid = N(nt, 'ShaderNodeTexNoise', -1750, 0, Scale=6.5, Detail=8.0,
              Roughness=0.55)
    n_fine = N(nt, 'ShaderNodeTexNoise', -1750, -260, Scale=48.0, Detail=10.0,
               Roughness=0.62)
    n_micro = N(nt, 'ShaderNodeTexNoise', -1750, -520, Scale=190.0, Detail=6.0,
                Roughness=0.5)
    for n in (n_big, n_mid, n_fine, n_micro):
        L(nt, scl, 'Vector', n, 'Vector')

    # base colour: mottled paint
    ramp = N(nt, 'ShaderNodeValToRGB', -1450, 250)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.68
    L(nt, n_big, 'Fac', ramp, 'Fac')

    dark = tuple(c * 0.62 for c in color)
    light = tuple(min(1.0, c * 1.55) for c in color)
    c1 = mixrgb(nt, -1150, 250, mottle, dark, light)
    # `mottle` used to be handed to mixrgb as the factor and then immediately
    # overwritten by this link, so the parameter did nothing at all. Scaling the
    # ramp by it instead makes it live, and the 1.0 default keeps every existing
    # call rendering exactly as before.
    mott = math_n(nt, 'MULTIPLY', -1300, 150, b=mottle)
    nt.links.new(ramp.outputs['Color'], mott.inputs[0])
    nt.links.new(mott.outputs['Value'], c1.inputs[0])

    # edge wear from pointiness
    point = N(nt, 'ShaderNodeMapRange', -1450, -60, **{})
    point.inputs['From Min'].default_value = 0.46
    point.inputs['From Max'].default_value = 0.60
    point.clamp = True
    L(nt, geo, 'Pointiness', point, 'Value')
    wear_mul = math_n(nt, 'MULTIPLY', -1250, -60, b=wear)
    L(nt, point, 'Result', wear_mul, 0)
    # break the wear line up with noise so it is not a perfect outline
    wear_break = math_n(nt, 'MULTIPLY', -1080, -60)
    L(nt, wear_mul, 'Value', wear_break, 0)
    L(nt, n_fine, 'Fac', wear_break, 1)
    wear_amp = math_n(nt, 'MULTIPLY', -930, -60, b=2.4)
    L(nt, wear_break, 'Value', wear_amp, 0)
    wear_cl = math_n(nt, 'MINIMUM', -800, -60, b=1.0)
    L(nt, wear_amp, 'Value', wear_cl, 0)

    c2 = N(nt, 'ShaderNodeMix', -600, 250, data_type='RGBA', blend_type='MIX')
    L(nt, wear_cl, 'Value', c2.inputs[0], 0)
    nt.links.new(m_out(c1), sock(c2, 'A', 'RGBA'))
    sock(c2, 'B', 'RGBA').default_value = (*wear_color, 1)
    nt.links.new(m_out(c2), bsdf.inputs['Base Color'])

    # roughness
    r_var = N(nt, 'ShaderNodeMapRange', -1150, -420)
    r_var.inputs['To Min'].default_value = max(0.04, rough - 0.16)
    r_var.inputs['To Max'].default_value = min(1.0, rough + 0.16)
    L(nt, n_mid, 'Fac', r_var, 'Value')
    r_wear = N(nt, 'ShaderNodeMix', -800, -420, data_type='FLOAT')
    L(nt, wear_cl, 'Value', r_wear.inputs[0], 0)
    nt.links.new(r_var.outputs['Result'], sock(r_wear, 'A', 'VALUE'))
    sock(r_wear, 'B', 'VALUE').default_value = max(0.10, rough - 0.26)
    nt.links.new(sock(r_wear, 'Result', 'VALUE', out=True), bsdf.inputs['Roughness'])

    # bump: fine grain + micro tooth
    b_mix = math_n(nt, 'ADD', -1150, -700)
    L(nt, n_fine, 'Fac', b_mix, 0)
    L(nt, n_micro, 'Fac', b_mix, 1)
    bump = N(nt, 'ShaderNodeBump', -700, -700, Strength=micro, Distance=0.03)
    L(nt, b_mix, 'Value', bump, 'Height')
    L(nt, bump, 'Normal', bsdf, 'Normal')

    bsdf.inputs['Metallic'].default_value = metallic
    return m


def add_grooves(m, sx, sy, width=0.016, depth=0.5, on_wall=False,
                plate_var=0.10, bump_strength=0.9, detail_mix=0.25):
    """Add plate seams to an existing `metal` material, in world space."""
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    geo = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeNewGeometry'][0]
    sep = N(nt, 'ShaderNodeSeparateXYZ', -2000, 600)
    L(nt, geo, 'Position', sep, 'Vector')

    axes = ('X', 'Y') if not on_wall else ('Y', 'Z')
    sizes = (sx, sy)
    masks = []
    tiles = []
    for i, (ax, s) in enumerate(zip(axes, sizes)):
        wrap = math_n(nt, 'WRAP', -1800, 700 - i * 300, b=0.0)
        wrap.inputs[2].default_value = s
        L(nt, sep, ax, wrap, 0)
        inv = math_n(nt, 'SUBTRACT', -1650, 700 - i * 300, a=s)
        L(nt, wrap, 'Value', inv, 1)
        dmin = math_n(nt, 'MINIMUM', -1500, 700 - i * 300)
        L(nt, wrap, 'Value', dmin, 0)
        L(nt, inv, 'Value', dmin, 1)
        mr = N(nt, 'ShaderNodeMapRange', -1350, 700 - i * 300)
        mr.inputs['From Min'].default_value = 0.0
        mr.inputs['From Max'].default_value = width
        mr.inputs['To Min'].default_value = 1.0
        mr.inputs['To Max'].default_value = 0.0
        mr.clamp = True
        L(nt, dmin, 'Value', mr, 'Value')
        masks.append(mr)
        # per plate id
        div = math_n(nt, 'DIVIDE', -1800, 300 - i * 160, b=s)
        L(nt, sep, ax, div, 0)
        flr = math_n(nt, 'FLOOR', -1650, 300 - i * 160)
        L(nt, div, 'Value', flr, 0)
        tiles.append(flr)

    seam = math_n(nt, 'MAXIMUM', -1150, 620)
    L(nt, masks[0], 'Result', seam, 0)
    L(nt, masks[1], 'Result', seam, 1)

    comb = N(nt, 'ShaderNodeCombineXYZ', -1500, 120)
    L(nt, tiles[0], 'Value', comb, 'X')
    L(nt, tiles[1], 'Value', comb, 'Y')
    wn = N(nt, 'ShaderNodeTexWhiteNoise', -1350, 120)
    L(nt, comb, 'Vector', wn, 'Vector')

    # darken at seams, vary plate to plate
    src = bsdf.inputs['Base Color'].links[0].from_socket
    pv = N(nt, 'ShaderNodeMix', -300, 400, data_type='RGBA', blend_type='MULTIPLY')
    pv.inputs[0].default_value = plate_var
    nt.links.new(src, sock(pv, 'A', 'RGBA'))
    pv_ramp = N(nt, 'ShaderNodeValToRGB', -500, 120)
    pv_ramp.color_ramp.elements[0].color = (0.55, 0.55, 0.58, 1)
    pv_ramp.color_ramp.elements[1].color = (1.5, 1.5, 1.5, 1)
    L(nt, wn, 'Value', pv_ramp, 'Fac')
    nt.links.new(pv_ramp.outputs['Color'], sock(pv, 'B', 'RGBA'))

    sm = N(nt, 'ShaderNodeMix', -80, 400, data_type='RGBA', blend_type='MIX')
    L(nt, seam, 'Value', sm.inputs[0], 0)
    nt.links.new(m_out(pv), sock(sm, 'A', 'RGBA'))
    sock(sm, 'B', 'RGBA').default_value = (0.006, 0.006, 0.008, 1)
    nt.links.new(m_out(sm), bsdf.inputs['Base Color'])

    # roughen the seams
    rsrc = bsdf.inputs['Roughness'].links[0].from_socket
    rm = N(nt, 'ShaderNodeMix', -80, 60, data_type='FLOAT')
    L(nt, seam, 'Value', rm.inputs[0], 0)
    nt.links.new(rsrc, sock(rm, 'A', 'VALUE'))
    sock(rm, 'B', 'VALUE').default_value = 0.85
    nt.links.new(sock(rm, 'Result', 'VALUE', out=True), bsdf.inputs['Roughness'])

    # cut the seams into the bump
    # NOTE this takes the bump over from metal(): both the strength set here and
    # detail_mix override whatever `micro` asked for. On a floor seen at a
    # grazing angle the inherited 1 cm noise becomes speckle, so those two knobs
    # exist to turn it down without touching the seams.
    bump = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeBump'][0]
    hsrc = bump.inputs['Height'].links[0].from_socket
    hm = math_n(nt, 'MULTIPLY', -400, -900, b=detail_mix)
    nt.links.new(hsrc, hm.inputs[0])
    neg = math_n(nt, 'MULTIPLY', -400, -1050, b=-depth)
    L(nt, seam, 'Value', neg, 0)
    tot = math_n(nt, 'ADD', -250, -980)
    L(nt, hm, 'Value', tot, 0)
    L(nt, neg, 'Value', tot, 1)
    nt.links.new(tot.outputs['Value'], bump.inputs['Height'])
    bump.inputs['Strength'].default_value = bump_strength
    bump.inputs['Distance'].default_value = 0.06
    return m


def add_seam_glow(m, sx, sy, width=0.018, color=(0.34, 0.70, 1.0), strength=7.0,
                  keep=0.52, node_boost=1.5):
    """Light the tile seams, on a SUBSET of the lines.

    Same wrap-per-tile arithmetic add_grooves() uses, at the same pitch, so the
    emission lands inside the grooves rather than beside them — a lit recessed
    channel rather than a painted stripe.

    Every seam glowing reads as a lightmap test; the reference has gaps. So each
    line is hashed by its own index and switched on or off, which keeps a line
    consistent along its whole length instead of flickering per pixel. Crossings
    get an extra kick, which is what makes the bright nodes at intersections.
    """
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    geos = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeNewGeometry']
    geo = geos[0] if geos else N(nt, 'ShaderNodeNewGeometry', -2400, 900)
    sep = N(nt, 'ShaderNodeSeparateXYZ', -2100, 1100)
    L(nt, geo, 'Position', sep, 'Vector')

    lit = []
    for k, (axis, s) in enumerate((('X', sx), ('Y', sy))):
        row = 1300 - k * 420
        wrap = math_n(nt, 'WRAP', -1900, row, b=0.0)
        wrap.inputs[2].default_value = s
        L(nt, sep, axis, wrap, 0)
        inv = math_n(nt, 'SUBTRACT', -1750, row, a=s)
        L(nt, wrap, 'Value', inv, 1)
        dmin = math_n(nt, 'MINIMUM', -1600, row)
        L(nt, wrap, 'Value', dmin, 0)
        L(nt, inv, 'Value', dmin, 1)
        mr = N(nt, 'ShaderNodeMapRange', -1450, row)
        mr.inputs['From Min'].default_value = 0.0
        mr.inputs['From Max'].default_value = width
        mr.inputs['To Min'].default_value = 1.0
        mr.inputs['To Max'].default_value = 0.0
        mr.clamp = True
        L(nt, dmin, 'Value', mr, 'Value')

        # which line am I on — hashed per index so a line is on for its length
        div = math_n(nt, 'DIVIDE', -1900, row - 200, b=s)
        L(nt, sep, axis, div, 0)
        idx = math_n(nt, 'ROUND', -1750, row - 200)
        L(nt, div, 'Value', idx, 0)
        comb = N(nt, 'ShaderNodeCombineXYZ', -1600, row - 200)
        L(nt, idx, 'Value', comb, 'XY'[k])
        wn = N(nt, 'ShaderNodeTexWhiteNoise', -1450, row - 200)
        L(nt, comb, 'Vector', wn, 'Vector')
        gate = math_n(nt, 'GREATER_THAN', -1300, row - 200, b=keep)
        L(nt, wn, 'Value', gate, 0)

        on = math_n(nt, 'MULTIPLY', -1100, row)
        L(nt, mr, 'Result', on, 0)
        L(nt, gate, 'Value', on, 1)
        lit.append(on)

    glow = math_n(nt, 'MAXIMUM', -900, 1200)
    L(nt, lit[0], 'Value', glow, 0)
    L(nt, lit[1], 'Value', glow, 1)
    cross = math_n(nt, 'MULTIPLY', -900, 1020)
    L(nt, lit[0], 'Value', cross, 0)
    L(nt, lit[1], 'Value', cross, 1)
    cross_b = math_n(nt, 'MULTIPLY', -750, 1020, b=node_boost)
    L(nt, cross, 'Value', cross_b, 0)
    tot = math_n(nt, 'ADD', -600, 1120)
    L(nt, glow, 'Value', tot, 0)
    L(nt, cross_b, 'Value', tot, 1)
    amt = math_n(nt, 'MULTIPLY', -450, 1120, b=strength)
    L(nt, tot, 'Value', amt, 0)

    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    L(nt, amt, 'Value', bsdf, 'Emission Strength')
    return m


def polished_floor(name, color=(0.006, 0.0075, 0.012), rough=0.13, smear=0.05,
                   smear_scale=0.35, metallic=0.0):
    """A dark reflective deck meant to be seen at a GRAZING angle.

    Deliberately not metal(): that builds four octaves of world-space noise, and
    the 6.5-scale one (~15 cm features) drops below a period per pixel out at
    15 m and aliases into glitter. Everything here is broad and soft — nothing
    under about a metre — because averaging a smooth gradient returns the same
    gradient, so the deck reads identically near and far.

    Leaves Base Color, Roughness and a Bump node wired so add_grooves() can
    splice the tile seams in on top.
    """
    m, nt, bsdf = new_mat(name)
    geo = worldpos(nt)

    broad = N(nt, 'ShaderNodeTexNoise', -1200, -200, Scale=smear_scale,
              Detail=3.0, Roughness=0.45)
    L(nt, geo, 'Position', broad, 'Vector')

    rgb = N(nt, 'ShaderNodeRGB', -800, 300)
    rgb.outputs[0].default_value = (*color, 1)
    L(nt, rgb, 'Color', bsdf, 'Base Color')

    rv = N(nt, 'ShaderNodeMapRange', -800, -100)
    rv.inputs['To Min'].default_value = max(0.02, rough - smear)
    rv.inputs['To Max'].default_value = min(1.0, rough + smear)
    L(nt, broad, 'Fac', rv, 'Value')
    L(nt, rv, 'Result', bsdf, 'Roughness')

    bump = N(nt, 'ShaderNodeBump', -500, -450, Strength=0.0, Distance=0.04)
    L(nt, broad, 'Fac', bump, 'Height')
    L(nt, bump, 'Normal', bsdf, 'Normal')

    bsdf.inputs['Metallic'].default_value = metallic
    return m


def emissive(name, color=(1.0, 0.96, 0.9), strength=20.0):
    m, nt, bsdf = new_mat(name)
    nt.nodes.remove(bsdf)
    out = nt.nodes['Material Output']
    e = N(nt, 'ShaderNodeEmission', 1000, 0, Color=(*color, 1), Strength=strength)
    L(nt, e, 'Emission', out, 'Surface')
    return m


def glass_screen(name, color=(0.02, 0.025, 0.03), strength=0.0):
    m, nt, bsdf = new_mat(name)
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 0.09
    bsdf.inputs['Metallic'].default_value = 0.0
    try:
        bsdf.inputs['Coat Weight'].default_value = 1.0
        bsdf.inputs['Coat Roughness'].default_value = 0.03
    except KeyError:
        pass
    if strength:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    return m


def add_light(name, kind, loc, energy, size=0.3, rot=(0, 0, 0),
              color=(1, 0.96, 0.90), spot_size=60, blend=0.45, sy=None):
    d = bpy.data.lights.new(name, kind)
    d.energy = energy
    d.color = color
    if kind == 'AREA':
        d.shape = 'RECTANGLE' if sy else 'SQUARE'
        d.size = size
        if sy:
            d.size_y = sy
    elif kind == 'SPOT':
        d.spot_size = R(spot_size)
        d.spot_blend = blend
        d.shadow_soft_size = size
    elif kind == 'POINT':
        d.shadow_soft_size = size
    ob = bpy.data.objects.new(name, d)
    ob.location = loc
    ob.rotation_euler = rot
    # every visible source in shot is emissive geometry; the lamps themselves
    # must never appear as white rectangles in frame
    try:
        ob.visible_camera = False
    except AttributeError:
        pass
    coll('Lights').objects.link(ob)
    return ob


def build_world():
    w = bpy.data.worlds.new('Bay')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = N(nt, 'ShaderNodeOutputWorld', 400, 0)
    bg = N(nt, 'ShaderNodeBackground', 200, 0, Color=(0.012, 0.015, 0.022, 1),
           Strength=1.0)
    L(nt, bg, 'Background', out, 'Surface')


def setup_render(res=(1712, 907), samples=96):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPTIX'
    except Exception:
        pass
    sc.cycles.max_bounces = 12
    sc.cycles.glossy_bounces = 8
    sc.cycles.transmission_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 92
    sc.view_settings.view_transform = 'AgX'
    for look in ('AgX - Medium High Contrast', 'Medium High Contrast',
                 'AgX - Base Contrast', 'None'):
        try:
            sc.view_settings.look = look
            break
        except Exception:
            continue
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0


