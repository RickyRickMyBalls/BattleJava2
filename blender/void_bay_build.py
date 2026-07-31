"""Void Bay — dark empty hangar, procedural Blender build.

Rebuilds from scratch every run. Run through the BlenderMCP bridge:
    python bmcp.py run run_void.py

Camera looks down +Y from y=0 at the back wall. Everything is metric.

Framing is solved off the reference rather than eyeballed:
  * the floor/wall junction sits at 61.5% of frame height and the wall's top
    edge at 15.9%, which with a level camera pins the eye at 1.65 m on a 24 mm
    lens ~17 m out;
  * the side walls are visible as dark wedges at the extreme frame edges, and
    that ONLY happens if the room is narrower than the frustum at the wall —
    which fixes the half width near 9.9 m.
"""
import sys, importlib

LIB_DIR = r"H:\sbAPPS\BattleJava2\blender"
if LIB_DIR not in sys.path:
    sys.path.append(LIB_DIR)
import fc_lib
importlib.reload(fc_lib)
from fc_lib import *

import bpy, math, random
from mathutils import Vector

R = math.radians
random.seed(23)


# ---------------------------------------------------------------- dimensions
WX      = 9.90       # inner face of the side walls
Y_BACK  = 17.00      # inner face of the back wall
Y_FRONT = -8.00
Z_TOP   = 7.00       # ceiling slab underside

# ---- the portal --------------------------------------------------------
# Measured off the plate: the opening's half width tracks 0.557 x depth and the
# frame's outer edge 0.638 x depth, so the frame reaches the side walls and its
# members are ~1.26 m across. That fixes the frame at y=14.4 with the opening at
# +/-8.64, its head at z=5.17 and the outer top at z=5.85.
PORTAL_Y0 = 14.40    # front face of the frame
PORTAL_Y1 = 15.60    # back face
OPEN_X    = 8.64     # opening half width
OPEN_Z    = 5.17     # underside of the top rail
PORTAL_Z  = 5.85     # outer top of the frame
CHAM      = 0.75     # 45-degree cut across the opening's top corners

COVE_Z   = 0.20      # centre of the glowing strip — low, at the wall base
TILE     = 2.90      # floor plate pitch
LIGHT_XS = [-7.0 + i * 1.75 for i in range(9)]   # downlights inside the recess

CAM_Z    = 1.65
CAM_LENS = 24.0
RES      = (1200, 661)      # 1.815:1, matching the reference plate


MAT = {}

def build_materials():
    # Near-black blue steel. Wear is kept low — this room is clean, and the
    # pointiness wear that sold the armory's edges would read as grime here.
    MAT['hull'] = metal('VB_hull', (0.0100, 0.0125, 0.0190), rough=0.44,
                        wear=0.20, wear_color=(0.10, 0.12, 0.15), micro=0.045)
    add_grooves(MAT['hull'], 2.60, 1.90, width=0.016, depth=0.5, on_wall=True,
                plate_var=0.06)

    MAT['panel'] = metal('VB_panel', (0.0085, 0.0105, 0.0165), rough=0.40,
                         wear=0.18, wear_color=(0.10, 0.12, 0.15), micro=0.04)

    # Dielectric, not metal: the floor's whole job is a grazing-angle Fresnel
    # reflection of the cove, and a metal has no diffuse to sit under it.
    MAT['floor'] = polished_floor('VB_floor', (0.0060, 0.0075, 0.0120),
                                  rough=0.13, smear=0.055, smear_scale=0.30)
    add_grooves(MAT['floor'], TILE, TILE, width=0.014, depth=0.6, plate_var=0.08,
                bump_strength=0.35, detail_mix=0.0)
    # Strength stays modest on purpose: driven hard the seams clip to white and
    # the blue is gone, since AgX desaturates as it rolls off. The hue only
    # survives if the line sits just above the surface, not far above it.
    add_seam_glow(MAT['floor'], TILE, TILE, width=0.012,
                  color=(0.12, 0.48, 1.0), strength=4.0, keep=0.54)

    MAT['dark'] = metal('VB_dark', (0.0035, 0.0042, 0.0060), rough=0.62,
                        wear=0.08, micro=0.05)

    # Cool white with a blue lean rather than saturated cyan — a saturated hue
    # only clears a bloom threshold in G and B and comes out neon.
    MAT['cove'] = emissive('VB_cove', (0.62, 0.80, 1.00), 13.0)
    MAT['strip'] = emissive('VB_strip', (0.70, 0.85, 1.00), 30.0)
    # Wall markings read as faint LINES rather than lit signage, so they are
    # barely-emissive rather than bright — just enough to lift off a wall this
    # dark without turning into neon.
    MAT['line'] = emissive('VB_line', (0.42, 0.58, 0.80), 0.075)
    MAT['dots'] = emissive('VB_dots', (0.40, 0.60, 0.85), 0.30)


# ------------------------------------------------------------------- modules

def build_shell():
    g = 'Shell'
    depth = Y_BACK - Y_FRONT + 4
    midy = (Y_BACK + Y_FRONT) * .5
    box('floor', (2 * WX + 2, depth, 0.40), (0, midy, -0.20),
        mats=MAT['floor'], group=g, bev=0)
    box('ceiling', (2 * WX + 2, depth, 0.60), (0, midy, Z_TOP + 0.30),
        mats=MAT['dark'], group=g, bev=0)
    for s in (-1, 1):
        box('wall_%s' % ('L' if s < 0 else 'R'), (0.60, depth, Z_TOP + 1.2),
            (s * (WX + 0.30), midy, Z_TOP * .5), mats=MAT['hull'], group=g, bev=0)
    box('backwall', (2 * WX + 2, 0.60, Z_TOP + 1.2), (0, Y_BACK + 0.30, Z_TOP * .5),
        mats=MAT['panel'], group=g, bev=0)

    # Everything above the portal goes black in the reference — no readable
    # ceiling at all — so this is a dark header rather than a lit soffit.
    box('header', (2 * WX, Y_BACK - PORTAL_Y0 + 1.0, Z_TOP - PORTAL_Z + 0.4),
        (0, (Y_BACK + PORTAL_Y0) * .5 + 0.2, (PORTAL_Z + Z_TOP) * .5 + 0.2),
        mats=MAT['dark'], group=g, bev=0.03)
    # roof of the recess, between the portal head and the back wall
    box('recess_ceil', (2 * OPEN_X, Y_BACK - PORTAL_Y1, 0.30),
        (0, (Y_BACK + PORTAL_Y1) * .5, OPEN_Z + 0.15), mats=MAT['dark'],
        group=g, bev=0.02)


def build_portal():
    """The proscenium: two chamfered verticals closed by a top rail.

    Built as real 45-degree profiles rather than a bevel modifier on a box: the
    chamfer is the whole architectural language here, and those angled faces are
    what pick up the grazing cove light as the thin bright lines running up each
    column. Three nested layers, each stepping further into the room with its
    own smaller cut, over a flared foot that splays out to meet the floor.
    """
    g = 'Corners'
    W, D = 1.30, 2.60
    BIG, MED, SML = 0.40, 0.20, 0.05
    for s in (-1, 1):
        cx = s * (WX - W * .5)
        cy = Y_BACK - D * .5
        # corners run CCW from (+x,-y); the room-facing front corner takes the
        # big cut, the one buried against the side wall takes a medium one
        ch = (BIG, SML, SML, MED) if s < 0 else (MED, SML, SML, BIG)
        body = chamfer_rect(W, D, ch, cx, cy)
        prism('col_body%d' % s, body, 0.0, PORTAL_Z, mats=MAT['hull'], group=g)

        # flared foot: straight skirt, then a 45 taper up into the body
        wide = chamfer_rect(W + 0.52, D + 0.30, tuple(c * 1.25 for c in ch),
                            cx, cy)
        loft('col_foot%d' % s, [wide, wide, body], [0.0, 0.34, 0.98],
             mats=MAT['hull'], group=g)
        # collar where it meets the soffit
        cap = chamfer_rect(W + 0.34, D + 0.22, tuple(c * 1.15 for c in ch),
                           cx, cy)
        loft('col_cap%d' % s, [body, cap], [PORTAL_Z - 0.75, PORTAL_Z],
             mats=MAT['hull'], group=g)

        # nested layers, each proud of the last toward the camera
        spine = chamfer_rect(0.96, D, tuple(c * 0.80 for c in ch), cx, cy - 0.16)
        prism('col_spine%d' % s, spine, 0.90, OPEN_Z - 0.05,
              mats=MAT['panel'], group=g)
        rib = chamfer_rect(0.60, D, tuple(c * 0.60 for c in ch), cx, cy - 0.30)
        prism('col_rib%d' % s, rib, 1.25, OPEN_Z - 0.45,
              mats=MAT['panel'], group=g)

        # the little lit tell on the rib face
        box('col_sliver%d' % s, (0.055, 0.09, 0.60),
            (cx + s * 0.14, cy - 0.30 - D * .5 - 0.02, 2.75),
            mats=MAT['strip'], group=g, bev=0.008)

    # ---- top rail, closing the two verticals into a portal ----------------
    box('rail', (2 * OPEN_X, PORTAL_Y1 - PORTAL_Y0, PORTAL_Z - OPEN_Z),
        (0, (PORTAL_Y0 + PORTAL_Y1) * .5, (OPEN_Z + PORTAL_Z) * .5),
        mats=MAT['hull'], group=g, bev=0.02)
    # proud lower step, carrying the same offset as the columns' ribs so the
    # frame reads as one continuous set of layers turning the corner
    box('rail_step', (2 * OPEN_X - 0.12, 0.34, PORTAL_Z - OPEN_Z - 0.22),
        (0, PORTAL_Y0 - 0.15, (OPEN_Z + PORTAL_Z) * .5 - 0.07),
        mats=MAT['panel'], group=g, bev=0.02)

    # The 45s across the opening's top corners — the detail that makes it read
    # as this kind of architecture rather than a hole in a wall.
    for s in (-1, 1):
        for tag, (cham, y0, y1) in (
                ('main', (CHAM, PORTAL_Y0, PORTAL_Y1)),
                ('step', (CHAM * 0.82, PORTAL_Y0 - 0.32, PORTAL_Y0))):
            pts = [(s * OPEN_X, OPEN_Z - cham),
                   (s * OPEN_X, OPEN_Z),
                   (s * (OPEN_X - cham), OPEN_Z)]
            prism_xz('wedge_%s%d' % (tag, s), pts, y0, y1,
                     mats=MAT['hull'] if tag == 'main' else MAT['panel'],
                     group=g, bev=0.015)

    # downlight fixtures recessed into the roof of the recess
    for i, x in enumerate(LIGHT_XS):
        box('down_can%d' % i, (0.30, 0.20, 0.10),
            (x, Y_BACK - 0.45, OPEN_Z - 0.08), mats=MAT['dark'],
            group=g, bev=0.01)
        show_only(box('down_lens%d' % i, (0.22, 0.14, 0.03),
                      (x, Y_BACK - 0.45, OPEN_Z - 0.135),
                      mats=MAT['strip'], group=g, bev=0.006))


def show_only(ob):
    """Camera- and reflection-visible, but contributes no diffuse light.

    The emissive strips and the area lamps sit in the same place, so without
    this every photon is emitted twice — and a long thin mesh emitter grazing a
    polished floor is about the noisiest thing you can hand a path tracer. The
    lamps light the room (they sample well); the mesh only has to be SEEN, and
    to show up in the floor reflection, which is why glossy stays on.
    """
    ob.visible_diffuse = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    return ob


def annulus(name, cx, cz, r_out, r_in, y, segs=96, mats=None, group='Wall'):
    """A flat ring standing on the back wall, facing the camera."""
    verts = []
    for r in (r_out, r_in):
        for i in range(segs):
            a = i * math.tau / segs
            verts.append((cx + math.cos(a) * r, y, cz + math.sin(a) * r))
    faces = [(i, (i + 1) % segs, segs + (i + 1) % segs, segs + i)
             for i in range(segs)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    coll(group).objects.link(ob)
    if mats:
        ob.data.materials.append(mats)
    return ob


def dot_cluster(name, x, z, nx, nz, step=0.166, y=None):
    """One of the perforated patches scattered over the wall."""
    # proud of the bay plates, or the patches end up buried inside them
    y = Y_BACK - 0.12 if y is None else y
    d = box(name, (0.052, 0.05, 0.052), (x, y, z), mats=MAT['dots'],
            group='Wall', bev=0.008)
    arr(d, nx, step, axis=0)
    arr(d, nz, step, axis=2)
    return d


def build_wall():
    """Panel bays, the centre alignment ring, and the perforated clusters.

    Positions come off the plate: bay seams land at x = +/-4.1, the ring is
    1.5 m in radius centred at z=2.70, and the dot pitch measures ~0.166 m.
    """
    g = 'Wall'
    yw = Y_BACK - 0.02

    # bay seams — thin recessed strips, not modelled gaps
    for x in (-8.20, -4.10, 4.10, 8.20):
        box('seam_v%.1f' % x, (0.055, 0.05, OPEN_Z - 0.10),
            (x, yw, (OPEN_Z - 0.10) * .5), mats=MAT['dark'], group=g, bev=0.006)
    for z in (0.95, 4.95):
        box('seam_h%.1f' % z, (2 * OPEN_X - 0.3, 0.05, 0.05), (0, yw, z),
            mats=MAT['dark'], group=g, bev=0.006)
    # shallow plates over each bay, so the seams have an edge to catch light
    for x0, x1 in ((-8.20, -4.10), (-4.10, 4.10), (4.10, 8.20)):
        box('bay%.0f' % x0, (x1 - x0 - 0.14, 0.05, OPEN_Z - 1.25),
            ((x0 + x1) * .5, yw - 0.02, (OPEN_Z + 0.95) * .5 - 0.10),
            mats=MAT['panel'], group=g, bev=0.02)

    # centre alignment ring + crosshair
    annulus('ring', 0.0, 2.70, 1.50, 1.455, yw - 0.12, mats=MAT['line'], group=g)
    annulus('ring_in', 0.0, 2.70, 1.02, 1.00, yw - 0.12, mats=MAT['line'], group=g)
    box('cross_h', (4.34, 0.04, 0.030), (0, yw - 0.12, 2.70),
        mats=MAT['line'], group=g, bev=0.004)
    box('cross_v', (0.030, 0.04, 4.34), (0, yw - 0.12, 2.70),
        mats=MAT['line'], group=g, bev=0.004)
    for sx in (-1, 1):
        box('tick%d' % sx, (0.030, 0.04, 0.34), (sx * 1.98, yw - 0.12, 2.70),
            mats=MAT['line'], group=g, bev=0.004)

    # perforated patches — asymmetric, as in the plate
    for i, (x, z, nx, nz) in enumerate((
            (-7.70, 2.35, 5, 6), (-6.05, 3.05, 4, 4), (-5.10, 1.05, 5, 3),
            (-2.55, 3.55, 4, 4), (2.70, 3.55, 4, 4), (5.05, 1.05, 5, 3),
            (6.10, 3.05, 4, 4), (7.65, 2.35, 5, 6))):
        dot_cluster('dots%d' % i, x, z, nx, nz)


def build_cove():
    """The glowing channel at the wall base — the key light of the whole shot."""
    g = 'Cove'
    # Plinth stands proud of the wall; the strip lives on its FRONT face, so it
    # faces the room instead of being buried inside the plinth solid.
    box('plinth', (2 * OPEN_X, 0.40, 0.34), (0, Y_BACK - 0.20, 0.17),
        mats=MAT['hull'], group=g, bev=0.02)
    show_only(box('cove_strip', (2 * OPEN_X - 0.30, 0.06, 0.10),
                  (0, Y_BACK - 0.42, COVE_Z), mats=MAT['cove'], group=g,
                  bev=0.008))
    # lip above the strip, so the glow stays pinned to the floor line instead
    # of washing straight up the wall
    box('cove_lip', (2 * OPEN_X, 0.34, 0.09), (0, Y_BACK - 0.34, COVE_Z + 0.17),
        mats=MAT['hull'], group=g, bev=0.02)
    # Low blocks breaking the cove run. They sit FORWARD of the strip so they
    # read as dark silhouettes against the glow, which is how the plate has it.
    for x in (-6.25, 6.25):
        loft('cove_block%.0f' % x,
             [chamfer_rect(3.30, 0.80, (0.32,) * 4, x, Y_BACK - 1.10),
              chamfer_rect(2.95, 0.52, (0.26,) * 4, x, Y_BACK - 1.16)],
             [0.0, 0.40], mats=MAT['hull'], group=g)

    # corner strip lights high on the side walls — the two bright ticks at the
    # top edge of the reference frame
    for s in (-1, 1):
        box('cstrip_body%d' % s, (0.16, 1.80, 0.22), (s * (WX - 0.08), 13.0, 6.20),
            mats=MAT['dark'], group=g, bev=0.02)
        show_only(box('cstrip_lens%d' % s, (0.07, 1.55, 0.11),
                      (s * (WX - 0.19), 13.0, 6.20), mats=MAT['strip'],
                      group=g, bev=0.01))


def build_lights():
    # The cove, as an actual emitter. The rectangle's long axis is local X, so
    # keeping the light unrotated about Z leaves it running along world X and a
    # single X rotation is all that aims it: -90 puts the -Z normal on -Y.
    add_light('cove_L', 'AREA', (0, Y_BACK - 0.50, COVE_Z), 290,
              size=2 * WX - 0.4, sy=0.16, rot=(R(-90), 0, 0),
              color=(0.62, 0.80, 1.00))
    # ...and a second, softer one tilted down at the floor. Kept weak on
    # purpose: the plate's floor is bright near the wall by REFLECTION, not by
    # diffuse wash, and any real wash here raises the deck until the cyan seams
    # wash out in the middle of frame where they should read.
    add_light('cove_floor', 'AREA', (0, Y_BACK - 0.95, 0.55), 22,
              size=2 * WX - 0.4, sy=1.0, rot=(R(-140), 0, 0),
              color=(0.62, 0.80, 1.00))
    # Downlight row on the recess ceiling, just behind the portal head. These
    # are what put the narrow vertical streaks down the back wall — a positive
    # X rotation swings a spot's beam toward the wall at +Y.
    for i, x in enumerate(LIGHT_XS):
        add_light('down%d' % i, 'SPOT', (x, Y_BACK - 0.45, OPEN_Z - 0.15),
                  110, size=0.04, rot=(R(7), 0, 0), spot_size=26, blend=0.92,
                  color=(0.74, 0.86, 1.00))

    # whisper of fill on the back wall so the panel bays and markings sit just
    # above black instead of disappearing into it
    add_light('wall_fill', 'AREA', (0, Y_BACK - 2.4, 2.6), 45, size=16, sy=4.5,
              rot=(R(-90), 0, 0), color=(0.58, 0.72, 1.00))

    for s in (-1, 1):
        add_light('cstrip_L%d' % s, 'AREA', (s * (WX - 0.30), 13.0, 6.20), 50,
                  size=0.12, sy=1.5, rot=(0, R(-s * 90), 0),
                  color=(0.70, 0.85, 1.00))
    # Barely-there ambient, from BEHIND the camera. The first version of this
    # was a 16x20 m rectangle hung inside the room, and its own edge threw a
    # hard diagonal shadow line straight across the back wall.
    # Kept very low: the reference floor gets its light from the cove at the FAR
    # end and falls off toward the lens. Any real fill from behind the camera
    # lights the foreground brightest and inverts that gradient.
    add_light('amb', 'AREA', (0, Y_FRONT + 1.0, 3.4), 22, size=10, sy=5,
              rot=(R(90), 0, 0), color=(0.55, 0.68, 1.00))


def build_world():
    w = bpy.data.worlds.new('Void')
    bpy.context.scene.world = w
    nt = w.node_tree
    nt.nodes.clear()
    out = N(nt, 'ShaderNodeOutputWorld', 400, 0)
    bg = N(nt, 'ShaderNodeBackground', 200, 0,
           Color=(0.0016, 0.0022, 0.0040, 1), Strength=1.0)
    L(nt, bg, 'Background', out, 'Surface')

    # Thin haze filling the bay. This is what gives the cove and the downlights
    # a body in the air instead of only a surface they land on, and it lifts the
    # back wall off pure black. Forward-scattering (positive anisotropy) so the
    # glow pools around the sources rather than flattening the whole volume.
    vs = N(nt, 'ShaderNodeVolumeScatter', 200, -260,
           Color=(0.55, 0.72, 1.0, 1), Density=0.0072, Anisotropy=0.35)
    L(nt, vs, 'Volume', out, 'Volume')


def setup_compositor():
    """Fog-glow bloom over the render.

    Cycles has no bloom of its own, and without it every emissive here is a
    hard-edged shape: the reference's cove and seams both carry a soft halo,
    and that halo is most of what makes them read as light rather than as
    white-painted geometry.
    """
    sc = bpy.context.scene
    # Blender 5.x moved the scene compositor off Scene.node_tree and into a
    # node GROUP hung on the scene, and every Glare setting that used to be a
    # node property is now an input socket.
    old = bpy.data.node_groups.get('VB_comp')
    if old:
        bpy.data.node_groups.remove(old)
    ng = bpy.data.node_groups.new('VB_comp', 'CompositorNodeTree')
    sc.compositing_node_group = ng
    sc.use_nodes = True

    ng.interface.new_socket('Image', in_out='OUTPUT',
                            socket_type='NodeSocketColor')
    rl = ng.nodes.new('CompositorNodeRLayers')
    rl.location = (0, 0)
    gl = ng.nodes.new('CompositorNodeGlare')
    gl.location = (320, 0)
    # menu sockets take the DISPLAY name, not the old enum identifier
    for sock, val in (('Type', 'Fog Glow'), ('Quality', 'High'),
                      ('Threshold', 1.7), ('Size', 7.0), ('Strength', 0.30),
                      ('Smoothness', 0.4), ('Saturation', 1.15)):
        try:
            gl.inputs[sock].default_value = val
        except (KeyError, TypeError, AttributeError) as e:
            print('  glare socket %r not set: %s' % (sock, e))
    ex = ng.nodes.new('CompositorNodeExposure')
    ex.location = (620, 0)
    ex.inputs['Exposure'].default_value = 0.0
    bc = ng.nodes.new('CompositorNodeBrightContrast')
    bc.location = (820, 0)
    bc.inputs['Brightness'].default_value = -0.004
    bc.inputs['Contrast'].default_value = 0.055
    out = ng.nodes.new('NodeGroupOutput')
    out.location = (1240, 0)

    ng.links.new(rl.outputs['Image'], gl.inputs['Image'])
    ng.links.new(gl.outputs['Image'], ex.inputs['Image'])
    ng.links.new(ex.outputs['Image'], bc.inputs['Image'])

    # Vignette. The compositor's Mix node is gone in 5.x, so this rides on
    # AlphaOver instead: a blurred ellipse mask fades the graded image toward
    # black at the corners. If neither node is available the grade still ships,
    # just without the falloff.
    # No compositor vignette. It was built and cut: in 5.x the ellipse mask
    # centres on the origin rather than mid-frame, so inverting it to darken the
    # corners blacked the entire image, and the effect is not worth chasing the
    # API for — the lighting already falls off hard toward the frame edges,
    # which is where a vignette would have been doing its work anyway.
    ng.links.new(bc.outputs['Image'], out.inputs[0])


def build_camera():
    cd = bpy.data.cameras.new('Cam')
    cd.lens = CAM_LENS
    cd.sensor_width = 36.0
    cam = bpy.data.objects.new('Cam', cd)
    cam.location = (0, 0.0, CAM_Z)
    cam.rotation_euler = (R(90), 0, 0)   # dead level, straight down +Y
    coll('Lights').objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def main():
    wipe()
    build_materials()
    build_shell()
    build_portal()
    build_wall()
    build_cove()
    build_lights()
    build_world()
    build_camera()
    setup_compositor()
    setup_render(res=RES, samples=64)
    # Volumetrics are the expensive part of this scene; a coarser step keeps
    # the haze affordable without changing how it reads at this density.
    bpy.context.scene.cycles.volume_step_rate = 5.0
    bpy.context.scene.cycles.volume_preview_step_rate = 5.0
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print('VOID BUILD OK objects=%d base_faces=%d materials=%d' %
          (len(bpy.data.objects), tris, len(bpy.data.materials)))


main()
