"""Armory Bay — procedural Blender build.

Rebuilds the whole scene from scratch every run (idempotent). Run through the
BlenderMCP bridge:  python bmcp.py run run_build.py

Layout is metric, camera looks down +Y from the near end of the bay.
"""

import bpy, bmesh, math, random
from mathutils import Vector

TAU = math.tau
R = math.radians
random.seed(11)

# ---------------------------------------------------------------- dimensions
WX        = 9.6      # inner face of the side walls (x = +/- WX)
Y_BACK    = 12.0     # inner face of the back wall
Y_FRONT   = -13.5
Z_TOP     = 9.2      # ceiling

PANEL_X   = 5.65     # studded panel half width
PANEL_Z0  = 1.85     # studded panel bottom / top
PANEL_Z1  = 5.35
FRAME_X   = 6.55     # flared recess outer half width
FRAME_Z0  = 1.15
FRAME_Z1  = 6.05

LIGHT_XS  = (-3.15, -1.05, 1.05, 3.15)

# ------------------------------------------------------------------ scene io

def wipe():
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


def arr(ob, count, offset, axis=0, use_relative=False):
    m = ob.modifiers.new('arr%d' % axis, 'ARRAY')
    m.count = count
    m.use_relative_offset = use_relative
    m.use_constant_offset = not use_relative
    off = [0.0, 0.0, 0.0]
    off[axis] = offset
    m.constant_offset_displace = off
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
          mottle=0.35, tex_scale=1.0):
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
    nt.links.new(ramp.outputs['Color'], c1.inputs[0])

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
                plate_var=0.10):
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
    bump = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeBump'][0]
    hsrc = bump.inputs['Height'].links[0].from_socket
    hm = math_n(nt, 'MULTIPLY', -400, -900, b=0.25)
    nt.links.new(hsrc, hm.inputs[0])
    neg = math_n(nt, 'MULTIPLY', -400, -1050, b=-depth)
    L(nt, seam, 'Value', neg, 0)
    tot = math_n(nt, 'ADD', -250, -980)
    L(nt, hm, 'Value', tot, 0)
    L(nt, neg, 'Value', tot, 1)
    nt.links.new(tot.outputs['Value'], bump.inputs['Height'])
    bump.inputs['Strength'].default_value = 0.9
    bump.inputs['Distance'].default_value = 0.06
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


MAT = {}

def build_materials():
    MAT['hull'] = metal('MTL_hull', (0.036, 0.040, 0.050), rough=0.50,
                        wear=0.55, micro=0.06)
    add_grooves(MAT['hull'], 2.4, 1.6, width=0.020, depth=0.6, on_wall=True)

    MAT['plate'] = metal('MTL_plate', (0.030, 0.034, 0.042), rough=0.44,
                         wear=0.60, micro=0.05)
    MAT['floor'] = metal('MTL_floor', (0.026, 0.028, 0.033), rough=0.30,
                         wear=0.25, wear_color=(0.16, 0.17, 0.19), micro=0.035)
    add_grooves(MAT['floor'], 2.35, 2.35, width=0.022, depth=0.8, plate_var=0.18)

    MAT['steel'] = metal('MTL_steel', (0.085, 0.090, 0.100), rough=0.34,
                         wear=0.7, wear_color=(0.42, 0.43, 0.45), micro=0.045)
    MAT['bright'] = metal('MTL_bright', (0.20, 0.21, 0.225), rough=0.26,
                          wear=0.8, wear_color=(0.55, 0.56, 0.58), micro=0.04)
    MAT['dark'] = metal('MTL_dark', (0.014, 0.015, 0.019), rough=0.62,
                        wear=0.3, micro=0.07)
    MAT['rubber'] = metal('MTL_rubber', (0.010, 0.010, 0.011), rough=0.82,
                          metallic=0.0, wear=0.15, micro=0.12)
    MAT['lens'] = emissive('MTL_lens', (1.0, 0.955, 0.90), 42.0)
    MAT['strip'] = emissive('MTL_strip', (0.90, 0.94, 1.0), 9.0)
    MAT['emblem'] = emissive('MTL_emblem', (0.88, 0.93, 1.0), 6.0)
    MAT['screen'] = emissive('MTL_screen', (0.74, 0.80, 0.88), 2.1)
    MAT['glass'] = glass_screen('MTL_glass')


# ------------------------------------------------------------------- modules

def build_shell():
    g = 'Shell'
    box('floor', (2 * WX + 4, Y_BACK - Y_FRONT + 6, 0.5),
        (0, (Y_BACK + Y_FRONT) * .5, -0.25), mats=MAT['floor'], group=g, bev=0)
    box('ceiling', (2 * WX + 4, Y_BACK - Y_FRONT + 6, 0.6),
        (0, (Y_BACK + Y_FRONT) * .5, Z_TOP + 0.3), mats=MAT['dark'], group=g, bev=0)
    for s in (-1, 1):
        box('wall_%s' % ('L' if s < 0 else 'R'),
            (0.8, Y_BACK - Y_FRONT + 6, Z_TOP + 1),
            (s * (WX + 0.4), (Y_BACK + Y_FRONT) * .5, Z_TOP * .5),
            mats=MAT['hull'], group=g, bev=0)
    box('backwall', (2 * WX + 4, 0.8, Z_TOP + 1), (0, Y_BACK + 0.4, Z_TOP * .5),
        mats=MAT['hull'], group=g, bev=0)
    # near wall behind camera, so reflections have something to catch
    box('frontwall', (2 * WX + 4, 0.8, Z_TOP + 1), (0, Y_FRONT - 0.4, Z_TOP * .5),
        mats=MAT['hull'], group=g, bev=0)

    # floor inlay strips running to the back wall
    for s in (-1, 1):
        box('floor_rail_%d' % s, (0.26, Y_BACK - Y_FRONT, 0.035),
            (s * 7.4, (Y_BACK + Y_FRONT) * .5, 0.012), mats=MAT['steel'],
            group=g, bev=0.008)
    # drain grate strip, near left
    gr = box('grate_bar', (0.055, 1.5, 0.05), (-8.05, 1.2, 0.02),
             mats=MAT['dark'], group=g, bev=0.006)
    arr(gr, 22, 0.095, axis=0)
    box('grate_frame', (2.25, 1.75, 0.06), (-7.05, 1.2, 0.005),
        mats=MAT['steel'], group=g, bev=0.01)


def studded_panel():
    g = 'BackWall'
    # backing plate
    box('panel_back', (PANEL_X * 2, 0.30, PANEL_Z1 - PANEL_Z0),
        (0, Y_BACK - 0.15, (PANEL_Z0 + PANEL_Z1) * .5), mats=MAT['plate'],
        group=g, bev=0.01)

    # stud grid
    step = 0.2145
    nx, nz = 51, 16
    x0 = -(nx - 1) * step * .5
    z0 = (PANEL_Z0 + PANEL_Z1) * .5 - (nz - 1) * step * .5
    stud = cyl('stud', 0.049, 0.040, (x0, Y_BACK - 0.30 - 0.020, z0),
               rot=(R(90), 0, 0), verts=12, mats=MAT['plate'], group=g, bev=0.011)
    arr(stud, nx, step, axis=0)
    arr(stud, nz, step, axis=2)

    # sub-panel seams over the stud field
    for x in (-2.83, 0.0, 2.83):
        box('panel_vseam_%.1f' % x, (0.055, 0.10, PANEL_Z1 - PANEL_Z0 - 0.1),
            (x, Y_BACK - 0.34, (PANEL_Z0 + PANEL_Z1) * .5), mats=MAT['dark'],
            group=g, bev=0.006)
    for z in (2.72, 4.52):
        box('panel_hseam_%.1f' % z, (PANEL_X * 2 - 0.12, 0.10, 0.055),
            (0, Y_BACK - 0.34, z), mats=MAT['dark'], group=g, bev=0.006)

    # service hatches + fixing marks scattered over the field
    for (x, z, w, h) in ((-4.55, 3.15, 0.46, 0.46), (4.35, 2.35, 0.40, 0.40),
                         (1.55, 4.85, 0.62, 0.34), (-1.25, 2.10, 0.34, 0.34),
                         (3.20, 4.95, 0.44, 0.44)):
        box('hatch_%.1f_%.1f' % (x, z), (w, 0.06, h), (x, Y_BACK - 0.36, z),
            mats=MAT['steel'], group=g, bev=0.012)
        for sx in (-1, 1):
            for sz in (-1, 1):
                cyl('hatchbolt', 0.022, 0.03,
                    (x + sx * (w * .5 - 0.06), Y_BACK - 0.39, z + sz * (h * .5 - 0.06)),
                    rot=(R(90), 0, 0), verts=8, mats=MAT['bright'], group=g)
    for (x, z) in ((-3.9, 4.35), (2.35, 3.05), (-0.45, 4.55), (4.85, 4.15)):
        box('mark_h', (0.24, 0.03, 0.035), (x, Y_BACK - 0.36, z),
            mats=MAT['bright'], group=g, bev=0.004)
        box('mark_v', (0.035, 0.03, 0.24), (x, Y_BACK - 0.36, z),
            mats=MAT['bright'], group=g, bev=0.004)


def build_backwall():
    g = 'BackWall'
    studded_panel()

    # flared recess frame
    band('recess_flare',
         (-PANEL_X - 0.06, PANEL_X + 0.06, PANEL_Z0 - 0.06, PANEL_Z1 + 0.06),
         (-FRAME_X, FRAME_X, FRAME_Z0, FRAME_Z1),
         Y_BACK - 0.28, Y_BACK - 1.15, mats=MAT['plate'], group=g, thickness=0.16)

    # surround plate around the flare
    box('surround_top', (FRAME_X * 2 + 1.5, 0.36, 0.55),
        (0, Y_BACK - 1.32, FRAME_Z1 + 0.28), mats=MAT['hull'], group=g, bev=0.02)
    box('surround_bot', (FRAME_X * 2 + 1.5, 0.36, 1.15),
        (0, Y_BACK - 1.32, FRAME_Z0 - 0.58), mats=MAT['hull'], group=g, bev=0.02)
    for s in (-1, 1):
        box('surround_side%d' % s, (0.75, 0.36, FRAME_Z1 - FRAME_Z0 + 1.2),
            (s * (FRAME_X + 0.36), Y_BACK - 1.32, (FRAME_Z0 + FRAME_Z1) * .5),
            mats=MAT['hull'], group=g, bev=0.02)

    # heavy flanking pillars
    for s in (-1, 1):
        px = s * (FRAME_X + 1.35)
        box('pillar%d' % s, (1.5, 1.9, 6.6), (px, Y_BACK - 1.15, 3.3),
            mats=MAT['hull'], group=g, bev=0.03)
        box('pillar_face%d' % s, (1.05, 0.14, 5.7), (px, Y_BACK - 2.15, 3.35),
            mats=MAT['plate'], group=g, bev=0.02)
        # angled cheek that catches the light like the reference
        box('pillar_cheek%d' % s, (0.55, 1.6, 6.2), (px - s * 0.86, Y_BACK - 1.3, 3.35),
            rot=(0, R(-s * 14), 0), mats=MAT['plate'], group=g, bev=0.025)
        box('pillar_cap%d' % s, (1.9, 2.2, 0.42), (px, Y_BACK - 1.15, 6.76),
            mats=MAT['steel'], group=g, bev=0.02)
        box('pillar_shoe%d' % s, (1.85, 2.15, 0.5), (px, Y_BACK - 1.15, 0.25),
            mats=MAT['steel'], group=g, bev=0.02)
        # rivets down the pillar face
        rv = cyl('pillar_rivet%d' % s, 0.033, 0.05, (px - 0.42, Y_BACK - 2.25, 0.85),
                 rot=(R(90), 0, 0), verts=10, mats=MAT['steel'], group=g, bev=0.008)
        arr(rv, 2, 0.84, axis=0)
        arr(rv, 12, 0.46, axis=2)

    # upper band above the recess
    box('band_main', (2 * WX, 1.5, 0.92), (0, Y_BACK - 1.0, 6.5),
        mats=MAT['hull'], group=g, bev=0.03)
    box('band_lip', (2 * WX, 0.3, 0.22), (0, Y_BACK - 1.85, 6.16),
        mats=MAT['steel'], group=g, bev=0.02)
    bp = box('band_plate', (1.5, 0.10, 0.62), (-8.4, Y_BACK - 1.8, 6.55),
             mats=MAT['plate'], group=g, bev=0.02)
    arr(bp, 12, 1.6, axis=0)
    br = cyl('band_rivet', 0.030, 0.05, (-8.9, Y_BACK - 1.86, 6.18),
             rot=(R(90), 0, 0), verts=10, mats=MAT['steel'], group=g, bev=0.007)
    arr(br, 46, 0.39, axis=0)

    # down-light fixtures under the band
    for x in LIGHT_XS:
        box('fixture_%.2f' % x, (0.55, 0.42, 0.20), (x, Y_BACK - 1.35, 5.94),
            mats=MAT['steel'], group=g, bev=0.02)
        box('lens_%.2f' % x, (0.40, 0.30, 0.05), (x, Y_BACK - 1.35, 5.83),
            mats=MAT['lens'], group=g, bev=0.01)
        box('fix_arm_%.2f' % x, (0.10, 0.10, 0.22), (x, Y_BACK - 1.35, 6.12),
            mats=MAT['dark'], group=g, bev=0.01)


def build_upper():
    g = 'Upper'
    deck_z = 6.95
    y0, y1 = 8.6, 10.7

    # catwalk deck: grating slats
    slat = box('deck_slat', (2 * WX, 0.055, 0.09), (0, y0 + 0.1, deck_z),
               mats=MAT['dark'], group=g, bev=0.006)
    arr(slat, 21, 0.10, axis=1)
    box('deck_edge_f', (2 * WX, 0.14, 0.26), (0, y0 - 0.02, deck_z - 0.02),
        mats=MAT['steel'], group=g, bev=0.015)
    box('deck_edge_b', (2 * WX, 0.14, 0.26), (0, y1 + 0.02, deck_z - 0.02),
        mats=MAT['steel'], group=g, bev=0.015)
    box('deck_kick', (2 * WX, 0.08, 0.16), (0, y0 - 0.06, deck_z + 0.18),
        mats=MAT['steel'], group=g, bev=0.01)

    # brackets under the deck
    br = box('deck_bracket', (0.16, 1.9, 0.34), (-8.8, (y0 + y1) * .5, deck_z - 0.28),
             mats=MAT['steel'], group=g, bev=0.012)
    arr(br, 12, 1.6, axis=0)

    # railing
    post = box('rail_post', (0.075, 0.075, 1.12), (-9.2, y0 - 0.02, deck_z + 0.66),
               mats=MAT['steel'], group=g, bev=0.008)
    arr(post, 13, 1.55, axis=0)
    for dz, rad in ((1.12, 0.045), (0.72, 0.032), (0.36, 0.032)):
        cyl('rail_%.2f' % dz, rad, 2 * WX, (0, y0 - 0.02, deck_z + dz),
            rot=(0, R(90), 0), verts=12, mats=MAT['steel'], group=g)
    wire = box('rail_wire', (0.018, 0.018, 0.74), (-9.3, y0 - 0.02, deck_z + 0.72),
               mats=MAT['dark'], group=g, bev=0)
    arr(wire, 128, 0.146, axis=0)

    # ceiling girders across X
    for y in (2.0, 5.6, 9.2):
        ibeam('girder_%.1f' % y, 2 * WX + 1.0, h=0.55, w=0.38, t=0.06,
              loc=(0, y, Z_TOP - 0.55), mats=MAT['steel'], group=g)
    # longitudinal beams
    for x in (-6.6, -3.3, 0.0, 3.3, 6.6):
        ibeam('beam_%.1f' % x, Y_BACK - Y_FRONT, h=0.40, w=0.28, t=0.05,
              loc=(x, (Y_BACK + Y_FRONT) * .5, Z_TOP - 1.05),
              rot=(0, 0, R(90)), mats=MAT['dark'], group=g)
    # conduit runs
    for (x, z, r) in ((-7.8, Z_TOP - 1.5, 0.10), (-7.55, Z_TOP - 1.5, 0.07),
                      (7.8, Z_TOP - 1.5, 0.10), (7.55, Z_TOP - 1.5, 0.07),
                      (-2.0, Z_TOP - 1.55, 0.055), (2.0, Z_TOP - 1.55, 0.055)):
        cyl('conduit_%.1f' % x, r, Y_BACK - Y_FRONT, (x, (Y_BACK + Y_FRONT) * .5, z),
            rot=(R(90), 0, 0), verts=14, mats=MAT['dark'], group=g)
    # hangers
    hg = box('hanger', (0.06, 0.06, 0.55), (-7.7, -8.0, Z_TOP - 1.1),
             mats=MAT['dark'], group=g, bev=0.006)
    arr(hg, 12, 1.9, axis=1)
    hg2 = box('hanger_r', (0.06, 0.06, 0.55), (7.7, -8.0, Z_TOP - 1.1),
              mats=MAT['dark'], group=g, bev=0.006)
    arr(hg2, 12, 1.9, axis=1)

    # soffit closing the space above the catwalk
    box('soffit', (2 * WX, 1.6, 2.0), (0, Y_BACK - 0.9, 8.1),
        mats=MAT['dark'], group=g, bev=0.02)


def wall_door(s, y):
    """Rounded sci-fi hatch set into the side wall at x = s*WX."""
    g = 'Sides'
    x = s * (WX - 0.02)
    box('door_frame%d' % s, (0.34, 3.15, 3.95), (x - s * 0.02, y, 1.98),
        mats=MAT['steel'], group=g, bev=0.05)
    box('door_recess%d' % s, (0.26, 2.85, 3.65), (x - s * 0.12, y, 1.92),
        mats=MAT['dark'], group=g, bev=0.03)
    d = box('door_leaf%d' % s, (0.16, 2.45, 3.35), (x - s * 0.24, y, 1.80),
            mats=MAT['plate'], group=g, bev=0.0)
    m = d.modifiers.new('round', 'BEVEL')
    m.width = 0.42
    m.segments = 6
    m.limit_method = 'ANGLE'
    m.angle_limit = R(40)
    bevel(d, 0.012, 2)
    box('door_split%d' % s, (0.10, 0.06, 3.2), (x - s * 0.30, y, 1.80),
        mats=MAT['dark'], group=g, bev=0.008)
    for dy in (-0.95, 0.95):
        box('door_grip%d_%.1f' % (s, dy), (0.10, 0.14, 1.5), (x - s * 0.31, y + dy, 2.0),
            mats=MAT['steel'], group=g, bev=0.02)
    box('door_head%d' % s, (0.24, 1.1, 0.22), (x - s * 0.16, y, 3.82),
        mats=MAT['steel'], group=g, bev=0.02)


def emblem_panel(s, y, z):
    g = 'Sides'
    x = s * (WX - 0.03)
    box('emb_body%d' % s, (0.30, 1.05, 1.05), (x - s * 0.06, y, z),
        mats=MAT['steel'], group=g, bev=0.04)
    box('emb_face%d' % s, (0.12, 0.80, 0.80), (x - s * 0.24, y, z),
        mats=MAT['dark'], group=g, bev=0.02)
    # chevron mark
    for i, (dy, dz, ang) in enumerate(((-0.16, 0.02, 34), (0.16, 0.02, -34))):
        box('emb_chev%d_%d' % (s, i), (0.06, 0.42, 0.10), (x - s * 0.31, y + dy, z + dz),
            rot=(R(ang), 0, 0), mats=MAT['emblem'], group=g, bev=0.01)
    box('emb_bar%d' % s, (0.06, 0.34, 0.075), (x - s * 0.31, y, z - 0.24),
        mats=MAT['emblem'], group=g, bev=0.01)


def build_sides():
    g = 'Sides'
    for s in (-1, 1):
        x = s * (WX - 0.01)
        # pilasters marching down the wall
        p = box('pilaster%d' % s, (0.42, 0.95, 6.0), (x - s * 0.21, -7.5, 3.0),
                mats=MAT['plate'], group=g, bev=0.03)
        arr(p, 8, 2.6, axis=1)
        # panel infill between pilasters
        pi = box('wallplate%d' % s, (0.16, 1.5, 5.4), (x - s * 0.08, -6.2, 3.0),
                 mats=MAT['hull'], group=g, bev=0.025)
        arr(pi, 8, 2.6, axis=1)
        # kick rail + upper rail
        box('kick%d' % s, (0.36, Y_BACK - Y_FRONT, 0.55), (x - s * 0.18, 0.0, 0.28),
            mats=MAT['steel'], group=g, bev=0.02)
        box('urail%d' % s, (0.40, Y_BACK - Y_FRONT, 0.34), (x - s * 0.20, 0.0, 6.25),
            mats=MAT['steel'], group=g, bev=0.02)
        box('urail2%d' % s, (0.30, Y_BACK - Y_FRONT, 0.20), (x - s * 0.15, 0.0, 7.35),
            mats=MAT['dark'], group=g, bev=0.02)
        # rivet line along the kick rail
        rv = cyl('kick_rivet%d' % s, 0.028, 0.05, (x - s * 0.36, -12.0, 0.44),
                 rot=(0, R(90), 0), verts=10, mats=MAT['steel'], group=g, bev=0.006)
        arr(rv, 46, 0.52, axis=1)
        # vertical conduit
        cyl('wall_pipe%d' % s, 0.075, 6.0, (x - s * 0.52, -4.9, 3.0),
            rot=(0, 0, 0), verts=12, mats=MAT['dark'], group=g)

    wall_door(-1, 4.35)
    emblem_panel(-1, 2.05, 3.05)

    # strip light on the near-left bulkhead
    box('strip_body', (0.26, 0.34, 2.5), (-(WX - 0.16), -2.4, 3.35),
        mats=MAT['steel'], group=g, bev=0.03)
    box('strip_lens', (0.10, 0.20, 2.25), (-(WX - 0.30), -2.4, 3.35),
        mats=MAT['strip'], group=g, bev=0.02)

    # right-hand alcove with a console desk
    box('alcove_back', (0.30, 4.2, 4.2), ((WX - 0.20), 4.4, 2.1),
        mats=MAT['plate'], group=g, bev=0.02)
    for dz in (0.0, 4.2):
        box('alcove_lip%.1f' % dz, (0.9, 4.6, 0.34), ((WX - 0.55), 4.4, dz + 0.0),
            mats=MAT['steel'], group=g, bev=0.02)
    box('desk_body', (1.5, 2.9, 0.95), ((WX - 0.85), 4.3, 0.48),
        mats=MAT['dark'], group=g, bev=0.02)
    box('desk_top', (1.7, 3.1, 0.12), ((WX - 0.80), 4.3, 1.01),
        mats=MAT['steel'], group=g, bev=0.02)
    for dy in (-0.75, 0.75):
        box('desk_screen%.1f' % dy, (0.09, 1.15, 0.80), ((WX - 1.05), 4.3 + dy, 1.62),
            rot=(0, R(18), R(-14)), mats=MAT['screen'], group=g, bev=0.015)
        box('desk_screen_b%.1f' % dy, (0.10, 1.28, 0.92), ((WX - 1.00), 4.3 + dy, 1.60),
            rot=(0, R(18), R(-14)), mats=MAT['steel'], group=g, bev=0.02)

    # near-right tool cabinet
    box('cab_body', (1.35, 2.4, 1.05), (WX - 0.90, -1.6, 0.53),
        mats=MAT['dark'], group=g, bev=0.02)
    box('cab_top', (1.5, 2.55, 0.10), (WX - 0.88, -1.6, 1.09),
        mats=MAT['steel'], group=g, bev=0.015)
    dr = box('cab_drawer', (0.06, 2.2, 0.24), (WX - 1.58, -1.6, 0.28),
             mats=MAT['steel'], group=g, bev=0.015)
    arr(dr, 3, 0.30, axis=2)


def build_console():
    g = 'Console'
    cy = 8.25
    box('con_body', (12.6, 1.75, 1.50), (0, cy, 0.75), mats=MAT['dark'],
        group=g, bev=0.02)
    box('con_kick', (12.2, 0.30, 0.30), (0, cy - 0.90, 0.15), mats=MAT['dark'],
        group=g, bev=0.015)
    box('con_top', (13.3, 2.05, 0.16), (0, cy, 1.58), mats=MAT['steel'],
        group=g, bev=0.025)
    box('con_top2', (13.0, 1.90, 0.10), (0, cy, 1.70), mats=MAT['plate'],
        group=g, bev=0.02)
    box('con_face', (12.4, 0.10, 1.20), (0, cy - 0.90, 0.80), mats=MAT['plate'],
        group=g, bev=0.02)
    fr = cyl('con_rivet', 0.026, 0.05, (-6.0, cy - 0.96, 0.25),
             rot=(R(90), 0, 0), verts=10, mats=MAT['steel'], group=g, bev=0.006)
    arr(fr, 33, 0.375, axis=0)

    # raised rails along the top
    for dy in (-0.62, 0.62):
        box('con_rail%.2f' % dy, (12.2, 0.13, 0.11), (0, cy + dy, 1.80),
            mats=MAT['steel'], group=g, bev=0.02)
    # centre spine block
    box('con_spine', (6.2, 0.9, 0.22), (0, cy, 1.86), mats=MAT['plate'],
        group=g, bev=0.02)
    for x in (-2.35, 2.35):
        box('con_glass%.1f' % x, (2.9, 0.72, 0.05), (x, cy, 1.80),
            mats=MAT['glass'], group=g, bev=0.008)
    for x in (-4.6, 4.6):
        box('con_pod%.1f' % x, (1.3, 1.1, 0.28), (x, cy, 1.89), mats=MAT['steel'],
            group=g, bev=0.03)
        box('con_pod_face%.1f' % x, (1.05, 0.85, 0.04), (x, cy, 2.04),
            mats=MAT['glass'], group=g, bev=0.006)

    # angled screen wings at both ends
    for s in (-1, 1):
        for i, (dx, dy, sc) in enumerate(((5.55, -0.35, 1.0), (6.45, 0.30, 0.86))):
            base = box('wing_base%d_%d' % (s, i), (1.35 * sc, 1.0 * sc, 0.22),
                       (s * dx, cy + dy, 1.78), rot=(0, 0, R(-s * 22)),
                       mats=MAT['steel'], group=g, bev=0.03)
            box('wing_frame%d_%d' % (s, i), (1.30 * sc, 0.14, 1.05 * sc),
                (s * dx, cy + dy - 0.30, 2.30), rot=(R(-38), 0, R(-s * 22)),
                mats=MAT['steel'], group=g, bev=0.03)
            box('wing_face%d_%d' % (s, i), (1.10 * sc, 0.05, 0.86 * sc),
                (s * dx, cy + dy - 0.38, 2.32), rot=(R(-38), 0, R(-s * 22)),
                mats=MAT['screen'], group=g, bev=0.01)


def table_leg(x, y):
    g = 'Table'
    for dx in (-0.30, 0.30):
        box('leg_post%.1f_%.1f' % (x + dx, y), (0.24, 0.24, 0.80), (x + dx, y, 0.44),
            mats=MAT['steel'], group=g, bev=0.02)
        for fx in (-1, 1):
            box('leg_flute%.1f_%.1f_%d' % (x + dx, y, fx), (0.05, 0.05, 0.70),
                (x + dx + fx * 0.095, y - 0.13, 0.44), mats=MAT['dark'],
                group=g, bev=0.008)
    box('leg_yoke%.1f_%.1f' % (x, y), (0.80, 0.30, 0.16), (x, y, 0.86),
        mats=MAT['steel'], group=g, bev=0.02)
    box('leg_foot%.1f_%.1f' % (x, y), (0.92, 0.44, 0.10), (x, y, 0.09),
        mats=MAT['steel'], group=g, bev=0.02)
    for dx in (-0.32, 0.32):
        cyl('caster%.1f_%.1f_%.1f' % (x, y, dx), 0.085, 0.10, (x + dx, y, 0.05),
            rot=(0, R(90), 0), verts=16, mats=MAT['rubber'], group=g, bev=0.02)


def build_table():
    g = 'Table'
    cx, cy = 0.0, 0.55
    w, d = 7.8, 5.1
    top_z = 0.98
    box('tbl_top', (w, d, 0.15), (cx, cy, top_z), mats=MAT['plate'],
        group=g, bev=0.035, segs=3)
    box('tbl_sub', (w - 0.22, d - 0.22, 0.13), (cx, cy, top_z - 0.14),
        mats=MAT['steel'], group=g, bev=0.02)
    box('tbl_skirt', (w - 0.55, d - 0.55, 0.34), (cx, cy, top_z - 0.34),
        mats=MAT['dark'], group=g, bev=0.02)
    # inset plates on the deck surface
    cols, rows = 4, 2
    cw, ch = (w - 0.5) / cols, (d - 0.5) / rows
    for i in range(cols):
        for j in range(rows):
            px = -w * .5 + 0.25 + (i + 0.5) * cw
            py = -d * .5 + 0.25 + (j + 0.5) * ch
            box('tbl_plate%d_%d' % (i, j), (cw - 0.10, ch - 0.10, 0.022),
                (cx + px, cy + py, top_z + 0.085), mats=MAT['plate'],
                group=g, bev=0.012)
    box('tbl_slot', (0.10, d - 1.2, 0.03), (cx, cy, top_z + 0.078),
        mats=MAT['dark'], group=g, bev=0.006)
    # edge trim
    for s in (-1, 1):
        box('tbl_trim_x%d' % s, (0.10, d, 0.06), (cx + s * (w * .5 - 0.10), cy, top_z + 0.08),
            mats=MAT['steel'], group=g, bev=0.012)
        box('tbl_trim_y%d' % s, (w, 0.10, 0.06), (cx, cy + s * (d * .5 - 0.10), top_z + 0.08),
            mats=MAT['steel'], group=g, bev=0.012)
    # cross frame under the top
    lx, ly = w * .5 - 1.0, d * .5 - 0.85
    for s in (-1, 1):
        box('tbl_beam_x%d' % s, (0.26, d - 1.1, 0.30), (cx + s * lx, cy, 0.60),
            mats=MAT['steel'], group=g, bev=0.02)
        box('tbl_beam_y%d' % s, (w - 1.4, 0.26, 0.24), (cx, cy + s * ly, 0.62),
            mats=MAT['steel'], group=g, bev=0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            table_leg(cx + sx * lx, cy + sy * ly)


# -------------------------------------------------------------------- lights

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
    coll('Lights').objects.link(ob)
    return ob


def build_lights():
    # wall wash from the fixtures under the band.  A spot points down -Z, so a
    # positive X rotation swings the beam toward the back wall (+Y): grazing
    # light is what makes the stud field read.
    for i, x in enumerate(LIGHT_XS):
        add_light('wash%d' % i, 'SPOT', (x, Y_BACK - 1.30, 5.78), 620,
                  size=0.09, rot=(R(19), 0, 0), spot_size=104, blend=0.62,
                  color=(1.0, 0.955, 0.90))
        add_light('washfill%d' % i, 'POINT', (x, Y_BACK - 1.45, 5.72), 26,
                  size=0.22, color=(1.0, 0.95, 0.88))

    # strip light practical
    add_light('strip_L', 'AREA', (-(WX - 0.35), -2.4, 3.35), 90, size=0.22,
              sy=2.3, rot=(0, R(90), 0), color=(0.86, 0.92, 1.0))
    # emblem glow
    add_light('emblem_L', 'AREA', (-(WX - 0.45), 2.05, 3.05), 18, size=0.7,
              rot=(0, R(90), 0), color=(0.85, 0.92, 1.0))
    # alcove console glow
    add_light('alcove_L', 'AREA', (WX - 1.5, 4.3, 1.9), 35, size=1.4,
              rot=(0, R(-70), 0), color=(0.80, 0.88, 1.0))
    # console screen bounce
    for s in (-1, 1):
        add_light('wing_L%d' % s, 'AREA', (s * 5.9, 7.5, 2.4), 45, size=1.2,
                  rot=(R(-55), 0, R(-s * 22)), color=(0.82, 0.88, 0.98))
    # dim cool ambient so the upper structure and side walls read as silhouettes
    add_light('amb_top', 'AREA', (0, 3.0, Z_TOP - 0.5), 900, size=15, sy=18,
              rot=(0, 0, 0), color=(0.70, 0.79, 0.98))
    add_light('amb_front', 'AREA', (0, -11.5, 4.6), 700, size=14, sy=7,
              rot=(R(90), 0, 0), color=(0.68, 0.77, 0.97))
    # grazing kick down the side walls
    for s in (-1, 1):
        add_light('wall_kick%d' % s, 'AREA', (s * (WX - 1.2), 1.0, 7.4), 320,
                  size=1.2, sy=16, rot=(0, R(-s * 55), 0),
                  color=(0.72, 0.80, 0.98))
    # bounce over the console / table so the mid-ground is not a black slab
    add_light('mid_fill', 'AREA', (0, 5.5, 6.6), 260, size=9, sy=5,
              rot=(0, 0, 0), color=(0.78, 0.85, 1.0))


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


# -------------------------------------------------------------- camera/render

def build_camera():
    cd = bpy.data.cameras.new('Cam')
    cd.lens = 33.0
    cd.sensor_width = 36.0
    cd.dof.use_dof = True
    cd.dof.focus_distance = 19.0
    cd.dof.aperture_fstop = 7.1
    cam = bpy.data.objects.new('Cam', cd)
    cam.location = (0, -11.0, 4.05)
    cam.rotation_euler = (R(86.2), 0, 0)
    coll('Lights').objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


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


def main():
    wipe()
    build_materials()
    build_shell()
    build_backwall()
    build_upper()
    build_sides()
    build_console()
    build_table()
    build_lights()
    build_world()
    build_camera()
    setup_render()
    n = len(bpy.data.objects)
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print('BUILD OK objects=%d base_faces=%d materials=%d' %
          (n, tris, len(bpy.data.materials)))


main()
