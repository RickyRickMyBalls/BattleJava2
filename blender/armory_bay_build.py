"""Armory Bay — procedural Blender build.

Rebuilds the whole scene from scratch every run (idempotent). Run through the
BlenderMCP bridge:  python bmcp.py run run_build.py

Layout is metric, camera looks down +Y from the near end of the bay.
Geometry/material/light helpers live in fc_lib.py.
"""
import sys, importlib

LIB_DIR = r"H:\sbAPPS\BattleJava2\blender"
if LIB_DIR not in sys.path:
    sys.path.append(LIB_DIR)
import fc_lib
importlib.reload(fc_lib)
from fc_lib import *

import bpy, bmesh, math, random
from mathutils import Vector

R = math.radians
random.seed(11)


# ---------------------------------------------------------------- dimensions
WX        = 9.6      # inner face of the side walls (x = +/- WX)
Y_BACK    = 12.0     # inner face of the back wall
Y_FRONT   = -13.5
Z_TOP     = 10.3     # ceiling

PANEL_X   = 5.65     # studded panel half width
PANEL_Z0  = 1.85     # studded panel bottom / top
PANEL_Z1  = 5.35
FRAME_X   = 6.55     # flared recess outer half width
FRAME_Z0  = 1.15
FRAME_Z1  = 6.05

LIGHT_XS  = (-3.15, -1.05, 1.05, 3.15)

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
    step = 0.2340
    nx, nz = 47, 15
    x0 = -(nx - 1) * step * .5
    z0 = (PANEL_Z0 + PANEL_Z1) * .5 - (nz - 1) * step * .5
    stud = cyl('stud', 0.056, 0.044, (x0, Y_BACK - 0.30 - 0.022, z0),
               rot=(R(90), 0, 0), verts=12, mats=MAT['plate'], group=g, bev=0.013)
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
         Y_BACK - 0.28, Y_BACK - 1.15, mats=MAT['dark'], group=g, thickness=0.16)

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
        mats=MAT['dark'], group=g, bev=0.02)
    bp = box('band_plate', (1.5, 0.10, 0.62), (-8.4, Y_BACK - 1.8, 6.55),
             mats=MAT['plate'], group=g, bev=0.02)
    arr(bp, 12, 1.6, axis=0)
    br = cyl('band_rivet', 0.030, 0.05, (-8.9, Y_BACK - 1.86, 6.18),
             rot=(R(90), 0, 0), verts=10, mats=MAT['steel'], group=g, bev=0.007)
    arr(br, 46, 0.39, axis=0)

    # down-light fixtures under the band
    for x in LIGHT_XS:
        box('fixture_%.2f' % x, (0.55, 0.42, 0.20), (x, Y_BACK - 1.62, 5.90),
            mats=MAT['steel'], group=g, bev=0.02)
        box('lens_%.2f' % x, (0.40, 0.30, 0.05), (x, Y_BACK - 1.62, 5.79),
            mats=MAT['lens'], group=g, bev=0.01)
        box('fix_arm_%.2f' % x, (0.10, 0.10, 0.26), (x, Y_BACK - 1.62, 6.10),
            mats=MAT['dark'], group=g, bev=0.01)


def build_upper():
    g = 'Upper'
    deck_z = 7.10
    y0, y1 = 8.15, 10.45

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
    box('soffit', (2 * WX, 1.9, 1.7), (0, Y_BACK - 0.95, 9.45),
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
        # pilasters marching down the wall — the run stops short of the hatch
        # (left) and the alcove (right), which own y = 6.0 .. 10.4
        p = box('pilaster%d' % s, (0.42, 0.95, 6.0), (x - s * 0.21, -7.5, 3.0),
                mats=MAT['plate'], group=g, bev=0.03)
        arr(p, 6, 2.6, axis=1)
        box('pilaster_end%d' % s, (0.42, 0.95, 6.0), (x - s * 0.21, 11.35, 3.0),
            mats=MAT['plate'], group=g, bev=0.03)
        # panel infill between pilasters
        pi = box('wallplate%d' % s, (0.16, 1.5, 5.4), (x - s * 0.08, -6.2, 3.0),
                 mats=MAT['hull'], group=g, bev=0.025)
        arr(pi, 6, 2.6, axis=1)
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

    # Only the far slice of each side wall (y > ~6.6) falls inside the lens, so
    # the set dressing lives back there.
    wall_door(-1, 8.70)
    emblem_panel(-1, 7.35, 3.05)

    # lit strip on the left bulkhead, right at the edge of frame
    box('strip_body', (0.26, 0.34, 2.5), (-(WX - 0.16), 6.90, 3.35),
        mats=MAT['steel'], group=g, bev=0.03)
    box('strip_lens', (0.10, 0.20, 2.25), (-(WX - 0.30), 6.90, 3.35),
        mats=MAT['strip'], group=g, bev=0.02)

    # right-hand alcove with a console desk
    box('alcove_back', (0.30, 4.2, 4.2), ((WX - 0.20), 8.10, 2.1),
        mats=MAT['plate'], group=g, bev=0.02)
    for dz in (0.0, 4.2):
        box('alcove_lip%.1f' % dz, (0.9, 4.6, 0.28), ((WX - 0.55), 8.10, dz),
            mats=MAT['dark'], group=g, bev=0.02)
    box('desk_body', (1.5, 2.9, 0.95), ((WX - 0.85), 8.00, 0.48),
        mats=MAT['dark'], group=g, bev=0.02)
    box('desk_top', (1.7, 3.1, 0.12), ((WX - 0.80), 8.00, 1.01),
        mats=MAT['steel'], group=g, bev=0.02)
    for dy in (-0.75, 0.75):
        box('desk_screen%.1f' % dy, (0.09, 1.15, 0.80), ((WX - 1.05), 8.00 + dy, 1.62),
            rot=(0, R(18), R(-14)), mats=MAT['screen'], group=g, bev=0.015)
        box('desk_screen_b%.1f' % dy, (0.10, 1.28, 0.92), ((WX - 1.00), 8.00 + dy, 1.60),
            rot=(0, R(18), R(-14)), mats=MAT['steel'], group=g, bev=0.02)

    # tool cabinet tucked into the back-right corner
    box('cab_body', (1.35, 2.4, 1.05), (WX - 0.90, 10.70, 0.53),
        mats=MAT['dark'], group=g, bev=0.02)
    box('cab_top', (1.5, 2.55, 0.10), (WX - 0.88, 10.70, 1.09),
        mats=MAT['steel'], group=g, bev=0.015)
    dr = box('cab_drawer', (0.06, 2.2, 0.24), (WX - 1.58, 10.70, 0.28),
             mats=MAT['steel'], group=g, bev=0.015)
    arr(dr, 3, 0.30, axis=2)


def build_console():
    g = 'Console'
    cy = 8.25
    box('con_body', (12.6, 1.75, 1.50), (0, cy, 0.75), mats=MAT['plate'],
        group=g, bev=0.02)
    box('con_kick', (12.2, 0.30, 0.30), (0, cy - 0.90, 0.15), mats=MAT['dark'],
        group=g, bev=0.015)
    # horizontal breaks + vertical ribs on the console face
    for z, h in ((0.42, 0.09), (1.16, 0.07)):
        box('con_break%.2f' % z, (12.3, 0.09, h), (0, cy - 0.90, z),
            mats=MAT['steel'], group=g, bev=0.012)
    rib = box('con_rib', (0.12, 0.10, 0.95), (-5.85, cy - 0.91, 0.80),
              mats=MAT['steel'], group=g, bev=0.012)
    arr(rib, 12, 1.06, axis=0)
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

def build_lights():
    # wall wash from the fixtures under the band.  A spot points down -Z, so a
    # positive X rotation swings the beam toward the back wall (+Y): grazing
    # light is what makes the stud field read.
    for i, x in enumerate(LIGHT_XS):
        add_light('wash%d' % i, 'SPOT', (x, Y_BACK - 1.62, 5.72), 700,
                  size=0.10, rot=(R(34), 0, 0), spot_size=100, blend=0.90,
                  color=(1.0, 0.955, 0.885))
        add_light('washfill%d' % i, 'POINT', (x, Y_BACK - 1.75, 5.62), 7,
                  size=0.22, color=(1.0, 0.95, 0.88))
    # broad soft wash so the whole stud field sits above black
    add_light('panel_soft', 'AREA', (0, Y_BACK - 2.6, 5.2), 55, size=11, sy=2.5,
              rot=(R(58), 0, 0), color=(0.92, 0.94, 1.0))

    # strip light practical
    # a positive Y rotation aims an area lamp toward -X (the left wall)
    add_light('strip_L', 'AREA', (-(WX - 0.35), 6.90, 3.35), 90, size=0.22,
              sy=2.3, rot=(0, R(-90), 0), color=(0.86, 0.92, 1.0))
    # emblem glow
    add_light('emblem_L', 'AREA', (-(WX - 0.45), 7.35, 3.05), 18, size=0.7,
              rot=(0, R(90), 0), color=(0.85, 0.92, 1.0))
    # alcove console glow
    add_light('alcove_L', 'AREA', (WX - 1.5, 8.0, 1.9), 35, size=1.4,
              rot=(0, R(-70), 0), color=(0.80, 0.88, 1.0))
    # console screen bounce
    for s in (-1, 1):
        add_light('wing_L%d' % s, 'AREA', (s * 5.9, 7.5, 2.4), 45, size=1.2,
                  rot=(R(-55), 0, R(-s * 22)), color=(0.82, 0.88, 0.98))
    # dim cool ambient — just enough to separate the structure from black
    add_light('amb_top', 'AREA', (0, 3.0, Z_TOP - 0.5), 150, size=15, sy=18,
              rot=(0, 0, 0), color=(0.66, 0.76, 0.98))
    add_light('amb_front', 'AREA', (0, -11.5, 4.6), 110, size=14, sy=7,
              rot=(R(90), 0, 0), color=(0.64, 0.74, 0.97))
    # grazing kick down the side walls
    for s in (-1, 1):
        add_light('wall_kick%d' % s, 'AREA', (s * (WX - 1.2), 1.0, 7.6), 90,
                  size=1.2, sy=16, rot=(0, R(-s * 55), 0),
                  color=(0.70, 0.79, 0.98))
    # bounce over the console / table so the mid-ground is not a black slab
    add_light('mid_fill', 'AREA', (0, 5.5, 6.6), 70, size=9, sy=5,
              rot=(0, 0, 0), color=(0.76, 0.84, 1.0))
    # soft key onto the staging table and the floor around it
    add_light('table_key', 'AREA', (0, 1.2, 8.2), 420, size=7, sy=5,
              rot=(0, 0, 0), color=(0.88, 0.91, 1.0))
    add_light('floor_fill', 'AREA', (0, -5.0, 7.0), 420, size=13, sy=9,
              rot=(0, 0, 0), color=(0.78, 0.84, 0.98))
    # rim along the console lip
    add_light('console_rim', 'AREA', (0, 6.4, 3.4), 90, size=11, sy=1.2,
              rot=(R(118), 0, 0), color=(0.86, 0.90, 1.0))
    # practicals so the hatch and emblem read on the dark left wall
    add_light('door_L', 'AREA', (-(WX - 1.1), 8.30, 4.6), 90, size=2.4, sy=3.0,
              rot=(0, R(62), 0), color=(0.88, 0.92, 1.0))
    add_light('alcove_L2', 'AREA', (WX - 1.6, 8.10, 3.4), 40, size=2.0, sy=2.6,
              rot=(0, R(-62), 0), color=(0.84, 0.90, 1.0))


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
