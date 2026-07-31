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

SOFFIT_Z = 6.35      # where the dark overhang above the wall starts
COVE_Z   = 0.46      # centre of the glowing strip at the wall base

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
    add_grooves(MAT['floor'], 2.40, 2.40, width=0.014, depth=0.6, plate_var=0.08,
                bump_strength=0.35, detail_mix=0.0)

    MAT['dark'] = metal('VB_dark', (0.0035, 0.0042, 0.0060), rough=0.62,
                        wear=0.08, micro=0.05)

    # Cool white with a blue lean rather than saturated cyan — a saturated hue
    # only clears a bloom threshold in G and B and comes out neon.
    MAT['cove'] = emissive('VB_cove', (0.62, 0.80, 1.00), 26.0)
    MAT['strip'] = emissive('VB_strip', (0.70, 0.85, 1.00), 30.0)


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

    # Dark overhang across the top of the back wall. The reference has no
    # readable ceiling at all — it goes black above this line — so the soffit is
    # what ends the wall rather than a lit ceiling plane.
    box('soffit', (2 * WX, 1.40, Z_TOP - SOFFIT_Z),
        (0, Y_BACK - 0.70, (SOFFIT_Z + Z_TOP) * .5), mats=MAT['dark'],
        group=g, bev=0.03)
    box('soffit_lip', (2 * WX, 0.22, 0.16), (0, Y_BACK - 1.32, SOFFIT_Z + 0.02),
        mats=MAT['hull'], group=g, bev=0.02)


def build_corners():
    """Chamfered bulkhead columns where the side walls meet the back wall.

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
        prism('col_body%d' % s, body, 0.0, Z_TOP, mats=MAT['hull'], group=g)

        # flared foot: straight skirt, then a 45 taper up into the body
        wide = chamfer_rect(W + 0.52, D + 0.30, tuple(c * 1.25 for c in ch),
                            cx, cy)
        loft('col_foot%d' % s, [wide, wide, body], [0.0, 0.34, 0.98],
             mats=MAT['hull'], group=g)
        # collar where it meets the soffit
        cap = chamfer_rect(W + 0.34, D + 0.22, tuple(c * 1.15 for c in ch),
                           cx, cy)
        loft('col_cap%d' % s, [body, cap], [Z_TOP - 0.75, Z_TOP],
             mats=MAT['hull'], group=g)

        # nested layers, each proud of the last toward the camera
        spine = chamfer_rect(0.96, D, tuple(c * 0.80 for c in ch), cx, cy - 0.16)
        prism('col_spine%d' % s, spine, 0.90, Z_TOP - 0.55,
              mats=MAT['panel'], group=g)
        rib = chamfer_rect(0.60, D, tuple(c * 0.60 for c in ch), cx, cy - 0.30)
        prism('col_rib%d' % s, rib, 1.25, Z_TOP - 0.95,
              mats=MAT['panel'], group=g)

        # the little lit tell on the rib face
        box('col_sliver%d' % s, (0.055, 0.09, 0.60),
            (cx + s * 0.14, cy - 0.30 - D * .5 - 0.02, 2.75),
            mats=MAT['strip'], group=g, bev=0.008)


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


def build_cove():
    """The glowing channel at the wall base — the key light of the whole shot."""
    g = 'Cove'
    box('plinth', (2 * WX, 0.55, 0.42), (0, Y_BACK - 0.28, 0.21),
        mats=MAT['hull'], group=g, bev=0.02)
    show_only(box('cove_strip', (2 * WX - 0.30, 0.08, 0.14),
                  (0, Y_BACK - 0.52, COVE_Z), mats=MAT['cove'], group=g,
                  bev=0.01))
    # lip above the strip, so the glow stays pinned to the floor line instead
    # of washing straight up the wall
    box('cove_lip', (2 * WX, 0.40, 0.12), (0, Y_BACK - 0.36, COVE_Z + 0.13),
        mats=MAT['hull'], group=g, bev=0.02)

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
    add_light('cove_L', 'AREA', (0, Y_BACK - 0.62, COVE_Z), 420,
              size=2 * WX - 0.4, sy=0.16, rot=(R(-90), 0, 0),
              color=(0.62, 0.80, 1.00))
    # ...and a second, softer one tilted down at the floor, which is what makes
    # the long specular smear run toward the camera.
    add_light('cove_floor', 'AREA', (0, Y_BACK - 0.95, 0.55), 90,
              size=2 * WX - 0.4, sy=1.0, rot=(R(-140), 0, 0),
              color=(0.62, 0.80, 1.00))
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
    build_corners()
    build_cove()
    build_lights()
    build_world()
    build_camera()
    setup_render(res=RES, samples=64)
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print('VOID BUILD OK objects=%d base_faces=%d materials=%d' %
          (len(bpy.data.objects), tris, len(bpy.data.materials)))


main()
