"""Fix2Build: editing commands on the one canonical building model (the session's corrected geometry).

Every command builds a new wall / opening set, rebuilds openings, rooms and checks with the normal pipeline
(``run._rebuild``: user openings kept, ids stable) and is either returned as a preview (``dry_run``) or committed
to the undo history. Coordinates are working-image pixels, like every other geometry in the session; heights
are metres. The AI model is never re-run by an edit, and TopologyGuard never rewrites user edits: it only
reports issues on the edited geometry.

Commands (``op``):
  add_wall {x1, y1, x2, y2, thickness?}        move_wall {wall, dx, dy}           delete_wall {wall}
  move_end {wall, end, x, y}                    set_wall {wall, thickness?, height?}
  add_opening {wall, x, y, width, type}         move_opening {opening, offset}     resize_opening {opening, width}
  set_opening_type {opening, type}              delete_opening {opening}
  rename_room {room, name}                      reset {}
"""
from __future__ import annotations

import base64
import time

import numpy as np

from . import fixes as fx
from . import run as rn
from .structure import opening_polygon, wall_polygon
from .walls import Wall

OPENING_TYPES = ("door", "window", "opening")
LABEL = {"add_wall": "Wall added", "move_wall": "Wall moved", "delete_wall": "Wall deleted", "move_end": "Wall end moved",
         "set_wall": "Wall changed", "add_opening": "Opening added", "move_opening": "Opening moved",
         "resize_opening": "Opening resized", "set_opening_type": "Opening type changed",
         "delete_opening": "Opening removed", "rename_room": "Room renamed", "reset": "Reset to detected geometry"}


class EditError(ValueError):
    """The edit is not possible; the message is shown to the user."""


def _wall(walls: list[Wall], wid: str) -> Wall:
    w = next((v for v in walls if v.id == wid), None)
    if w is None:
        raise EditError("That wall no longer exists.")
    return w


def _opening(sess, oid: str) -> dict:
    o = next((v for v in sess.corrected.openings if v["id"] == oid), None)
    if o is None:
        raise EditError("That opening no longer exists.")
    return o


def _orient(x1, y1, x2, y2) -> str:
    dx, dy = abs(x2 - x1), abs(y2 - y1)
    return "h" if dx >= 3 * dy else "v" if dy >= 3 * dx else "d"


def _covers_opening(sess, w: Wall, old: Wall | None = None) -> dict | None:
    poly = wall_polygon(w) if old is None else wall_polygon(w).difference(wall_polygon(old))
    for o in sess.corrected.openings:
        if o["hosts"] and w.id in o["hosts"]:
            continue
        op = opening_polygon(o)
        if poly.intersection(op).area > 0.15 * op.area:
            return o
    return None


def _chain(sess, wid: str) -> list[str]:
    """A wall and the collinear pieces it forms one wall with (linked by openings in between)."""
    out, todo = {wid}, [wid]
    while todo:
        cur = todo.pop()
        for o in sess.corrected.openings:
            if cur in o["hosts"]:
                for h in o["hosts"]:
                    if h not in out:
                        out.add(h)
                        todo.append(h)
    return sorted(out)


def _min_piece(sess) -> float:
    return max(sess.thickness, 6.0)


# ------------------------------------------------------------------------------------------------ walls

def _add_wall(sess, walls, op):
    t = sess.thickness
    H, W = sess.image.dark.shape
    x1, y1, x2, y2 = (float(op[k]) for k in ("x1", "y1", "x2", "y2"))
    orient = _orient(x1, y1, x2, y2)
    if orient == "h":
        y2 = y1 = (y1 + y2) / 2
    elif orient == "v":
        x2 = x1 = (x1 + x2) / 2
    th = float(op.get("thickness") or t)
    if not (0.3 * t <= th <= 6 * t):
        raise EditError("Wall thickness is out of range.")
    nw = Wall(rn._new_id(sess, "w", {w.id for w in walls}), x1, y1, x2, y2, th, orient, source="edited")
    for end in (0, 1):
        px, py = (nw.x1, nw.y1) if end == 0 else (nw.x2, nw.y2)
        sx, sy, _ = rn._snap_end(walls, nw, px, py, t)
        if end == 0:
            nw.x1, nw.y1 = sx, sy
        else:
            nw.x2, nw.y2 = sx, sy
    if not all(0 <= v <= lim for v, lim in ((nw.x1, W), (nw.x2, W), (nw.y1, H), (nw.y2, H))):
        raise EditError("The wall must stay inside the drawing.")
    if nw.length < max(2 * t, 10):
        raise EditError("The wall is too short.")
    poly = wall_polygon(nw)
    for v in walls:
        if v.orient == nw.orient and poly.intersection(wall_polygon(v)).area > 0.5 * poly.area:
            raise EditError("A wall already exists here.")
    o = _covers_opening(sess, nw)
    if o is not None:
        raise EditError(f"The wall would block a {o['type']}.")
    return walls + [nw], [nw.id]


def _delete_wall(sess, walls, op):
    w = _wall(walls, op["wall"])
    return [v for v in walls if v.id != w.id], [w.id]


def _move_wall(sess, walls, op):
    """Translate a wall (with the pieces it forms one wall with) and keep the walls attached to it attached."""
    dx, dy = float(op.get("dx", 0)), float(op.get("dy", 0))
    _wall(walls, op["wall"])
    chain = set(_chain(sess, op["wall"]))
    new = [v.copy() for v in walls]
    by_id = {v.id: v for v in new}
    moved = [by_id[c] for c in chain if c in by_id]
    if moved[0].orient == "h":
        dx = 0.0          # a straight wall moves sideways; along its own axis nothing changes
    elif moved[0].orient == "v":
        dy = 0.0
    if abs(dx) < 0.5 and abs(dy) < 0.5:
        raise EditError("The wall did not move.")
    old_polys = {m.id: wall_polygon(m) for m in moved}
    for m in moved:
        m.x1 += dx; m.x2 += dx; m.y1 += dy; m.y2 += dy
        m.source = "edited"
    # Walls whose end touched a moved wall follow it along their own axis (rooms stay closed).
    from shapely.geometry import Point  # noqa: PLC0415
    for v in new:
        if v.id in chain or v.orient not in "hv":
            continue
        for end in (0, 1):
            px, py = (v.x1, v.y1) if end == 0 else (v.x2, v.y2)
            for m in moved:
                if m.orient == v.orient or old_polys[m.id].distance(Point(px, py)) > max(2.0, 0.5 * v.thickness):
                    continue
                if v.orient == "v":
                    ny = (m.y1 + m.y2) / 2
                    if end == 0:
                        v.y1 = ny
                    else:
                        v.y2 = ny
                else:
                    nx = (m.x1 + m.x2) / 2
                    if end == 0:
                        v.x1 = nx
                    else:
                        v.x2 = nx
                v.source = "edited"
                break
    for v in new:
        if v.length < 1.5 * sess.thickness:
            raise EditError("This move would collapse a connected wall.")
    for m in moved:
        o = _covers_opening(sess, m, walls[[w.id for w in walls].index(m.id)])
        if o is not None:
            raise EditError(f"The wall would block a {o['type']}.")
    return new, sorted(chain)


def _set_wall(sess, walls, op):
    w = _wall(walls, op["wall"])
    new = [v.copy() for v in walls]
    for c in _chain(sess, w.id):
        v = next((x for x in new if x.id == c), None)
        if v is None:
            continue
        if op.get("thickness") is not None:
            th = float(op["thickness"])
            if not (0.3 * sess.thickness <= th <= 6 * sess.thickness):
                raise EditError("Wall thickness is out of range.")
            v.thickness = th
        if "height" in op:
            h = op["height"]
            if h is not None and not (1.0 <= float(h) <= 8.0):
                raise EditError("Wall height must be between 1 and 8 m.")
            v.height = None if h is None else float(h)
        v.source = "edited"
    return new, [w.id]


# ------------------------------------------------------------------------------------------------ openings

def _add_opening(sess, walls, op):
    w = _wall(walls, op["wall"])
    kind = op.get("type", "door")
    if kind not in OPENING_TYPES:
        raise EditError("Unknown opening type.")
    width = float(op["width"])
    L = w.length
    ux, uy = (w.x2 - w.x1) / L, (w.y2 - w.y1) / L
    s = (float(op["x"]) - w.x1) * ux + (float(op["y"]) - w.y1) * uy        # projection onto the wall
    margin = max(sess.thickness, w.thickness) / 2 + 2
    if width < max(2 * sess.thickness, 8) or width > L - 2 * margin:
        raise EditError("The opening does not fit in this wall.")
    s = min(max(s, margin + width / 2), L - margin - width / 2)
    a, b = w.copy(), w.copy()
    a.x2, a.y2 = w.x1 + ux * (s - width / 2), w.y1 + uy * (s - width / 2)
    b.x1, b.y1 = w.x1 + ux * (s + width / 2), w.y1 + uy * (s + width / 2)
    b.id = rn._new_id(sess, "w", {v.id for v in walls})
    a.source = b.source = "edited"
    new = [v for v in walls if v.id != w.id] + [a, b]
    # Openings that used w as a host now use the piece next to them.
    keep = []
    for o in sess.corrected.openings:
        o = dict(o)
        if w.id in o["hosts"]:
            cx, cy = (o["x1"] + o["x2"]) / 2, (o["y1"] + o["y2"]) / 2
            near_b = np.hypot(cx - (b.x1 + b.x2) / 2, cy - (b.y1 + b.y2) / 2) < np.hypot(cx - (a.x1 + a.x2) / 2,
                                                                                         cy - (a.y1 + a.y2) / 2)
            o["hosts"] = [b.id if (h == w.id and near_b) else h for h in o["hosts"]]
        keep.append(o)
    oid = rn._new_id(sess, "o", {o["id"] for o in sess.corrected.openings})
    keep.append({"id": oid, "type": kind, "confidence": "high", "source": "user", "hosts": [a.id, b.id],
                 "x1": a.x2, "y1": a.y2, "x2": b.x1, "y2": b.y1, "width": width, "thickness": w.thickness})
    return new, [a.id, b.id], keep, oid


def _hosts(sess, walls, o):
    by_id = {v.id: v for v in walls}
    a, b = (by_id.get(h) for h in o["hosts"])
    g = rn.host_gap(a, b) if a is not None and b is not None else None
    if g is None:
        raise EditError("This opening is not between two pieces of the same wall, so it cannot be moved or resized.")
    return a, b, g


def _shift_ends(sess, walls, o, new_a_end, new_b_end):
    a, b, (pa, pb, ea, eb) = _hosts(sess, walls, o)
    new = [v.copy() for v in walls]
    by_id = {v.id: v for v in new}
    na, nb = by_id[a.id], by_id[b.id]
    for wall, end, p in ((na, ea, new_a_end), (nb, eb, new_b_end)):
        if end == 0:
            wall.x1, wall.y1 = p
        else:
            wall.x2, wall.y2 = p
        wall.source = "edited"
    if min(na.length, nb.length) < _min_piece(sess):
        raise EditError("The opening would run past the end of its wall.")
    for old, cur in ((a, na), (b, nb)):       # neither piece may flip over
        u = np.array([old.x2 - old.x1, old.y2 - old.y1]) / old.length
        if (np.array([cur.x2 - cur.x1, cur.y2 - cur.y1]) @ u) <= 0:
            raise EditError("The opening would run past the end of its wall.")
    keep = [dict(x, source="user") if x["id"] == o["id"] else x for x in sess.corrected.openings]
    return new, [a.id, b.id], keep


def _move_opening(sess, walls, op):
    o = _opening(sess, op["opening"])
    a, b, (pa, pb, ea, eb) = _hosts(sess, walls, o)
    d = np.array([pb[0] - pa[0], pb[1] - pa[1]])
    u = d / np.linalg.norm(d)
    off = float(op["offset"])
    return _shift_ends(sess, walls, o, tuple(np.array(pa) + u * off), tuple(np.array(pb) + u * off))


def _resize_opening(sess, walls, op):
    o = _opening(sess, op["opening"])
    a, b, (pa, pb, ea, eb) = _hosts(sess, walls, o)
    width = float(op["width"])
    if width < max(2 * sess.thickness, 8):
        raise EditError("The opening is too narrow.")
    c = (np.array(pa) + np.array(pb)) / 2
    u = (np.array(pb) - np.array(pa)) / np.linalg.norm(np.array(pb) - np.array(pa))
    return _shift_ends(sess, walls, o, tuple(c - u * width / 2), tuple(c + u * width / 2))


def _set_opening_type(sess, walls, op):
    o = _opening(sess, op["opening"])
    if op.get("type") not in OPENING_TYPES:
        raise EditError("Unknown opening type.")
    keep = [dict(x, type=op["type"], source="user", confidence="high") if x["id"] == o["id"] else x
            for x in sess.corrected.openings]
    return [v.copy() for v in walls], o["hosts"], keep


def _delete_opening(sess, walls, op):
    """Fill the opening with wall: the pieces either side become one wall again (or meet at the corner)."""
    o = _opening(sess, op["opening"])
    by_id = {v.id: v for v in walls}
    a, b = (by_id.get(h) for h in o["hosts"])
    if a is None or b is None:
        raise EditError("This opening has no host walls.")
    if rn.host_gap(a, b) is not None and a.orient == b.orient and a.orient in "hv":
        new = fx.apply_fix(walls, {"kind": "close_gap", "ids": [a.id, b.id], "a": a.id, "b": b.id})
    else:
        end = fx._end_index(a, (o["x1"] + o["x2"]) / 2, (o["y1"] + o["y2"]) / 2)
        new = fx.apply_fix(walls, {"kind": "connect", "ids": [a.id], "a": a.id, "end": end,
                                   "dist": o["width"] + b.thickness / 2})
    keep = [x for x in sess.corrected.openings if x["id"] != o["id"]]
    return new, [a.id, b.id], keep


# ------------------------------------------------------------------------------------------------ dispatch

WALL_OPS = {"add_wall": _add_wall, "delete_wall": _delete_wall, "move_wall": _move_wall, "set_wall": _set_wall,
            "add_opening": _add_opening, "move_opening": _move_opening, "resize_opening": _resize_opening,
            "set_opening_type": _set_opening_type, "delete_opening": _delete_opening}


def apply_edit(sess, op: dict, dry_run: bool = False) -> dict:
    """Run one editing command. Returns {ok, reason, preview?, created?}; commits unless ``dry_run``."""
    name = op.get("op")
    s = sess.scale["meters_per_px"]
    try:
        if name == "move_end":
            out = rn.edit_wall_end(sess, op["wall"], int(op["end"]), float(op["x"]), float(op["y"]), dry_run=True)
            if not out["ok"]:
                raise EditError(out["reason"])
            walls = [v.copy() for v in sess.corrected.walls]
            w = _wall(walls, op["wall"])
            a = out["after"]
            w.x1, w.y1, w.x2, w.y2, w.source = a["x1"], a["y1"], a["x2"], a["y2"], "edited"
            touched, keep, created = [w.id], None, None
        elif name == "rename_room":
            room = next((r for r in sess.corrected.rooms if r["id"] == op["room"]), None)
            if room is None:
                raise EditError("That room no longer exists.")
            label = str(op.get("name", "")).strip()[:40]
            if dry_run:
                return {"ok": True, "reason": None}
            names = dict(sess.room_names)
            if label:
                names[room["id"]] = label
            else:
                names.pop(room["id"], None)
            version = _renamed(sess, names)
            rn._commit(sess, version, _log(name, room["centroid"], []), rescale=False)
            sess.room_names = names
            rn.apply_room_names(sess, sess.corrected)
            return {"ok": True, "reason": None}
        elif name == "reset":
            if dry_run:
                return {"ok": True, "reason": None, "preview": rn._plain(rn._version_out(sess.auto_version, s))}
            rn._commit(sess, sess.auto_version, _log(name, [0, 0], []), rescale=False)
            sess.room_names = {}
            sess.fix_log = []
            sess.edited = False
            rn.refresh_issues(sess)
            return {"ok": True, "reason": None}
        elif name in WALL_OPS:
            res = WALL_OPS[name](sess, sess.corrected.walls, op)
            walls, touched = res[0], res[1]
            keep = res[2] if len(res) > 2 else None
            created = res[3] if len(res) > 3 else (touched[-1] if name == "add_wall" else None)
        else:
            raise EditError(f"Unknown editing command: {name}")
    except EditError as exc:
        return {"ok": False, "reason": str(exc)}
    except KeyError as exc:
        return {"ok": False, "reason": f"Missing field: {exc.args[0]}"}

    version = rn._rebuild(sess, walls, keep, known_only=True)
    lost = [o["id"] for o in (keep or sess.corrected.openings) if o.get("source") == "user"
            and o["id"] not in {x["id"] for x in version.openings}]
    out = {"ok": True, "reason": None, "created": created, "rooms_after": len(version.rooms),
           "removed_openings": lost}
    if dry_run:
        out["preview"] = rn._plain(rn._version_out(version, s))
        return rn._plain(out)
    at = [float(np.mean([v.x1 for v in walls if v.id in touched] or [0])),
          float(np.mean([v.y1 for v in walls if v.id in touched] or [0]))]
    rn._commit(sess, version, _log(name, at, touched), rescale=False)
    return rn._plain(out)


def _renamed(sess, names: dict):
    """The current geometry with different room names (same objects otherwise)."""
    import copy  # noqa: PLC0415
    v = copy.copy(sess.corrected)
    v.rooms = [dict(r) for r in sess.corrected.rooms]
    for r in v.rooms:
        if r["id"] in names:
            r["name"], r["user_named"] = names[r["id"]], True
            r["type"] = rn.room_type_for(r["name"])
        elif r.get("user_named"):
            r["name"], r["user_named"] = None, False
    return v


def _log(name, at, walls) -> dict:
    return {"check": "manual", "message": LABEL.get(name, "Edited"), "at": [float(at[0]), float(at[1])],
            "walls": list(walls), "kind": "manual"}


# ------------------------------------------------------------------------------------------------ save / reopen

PROJECT_FORMAT = "archnext-project"


def _inside_point(labels: np.ndarray, k: int) -> list[float]:
    ys, xs = np.nonzero(labels == k)
    i = int(np.argmin((xs - xs.mean()) ** 2 + (ys - ys.mean()) ** 2))
    return [float(xs[i]), float(ys[i])]


def export_project(sess) -> dict:
    """Everything needed to reopen the edited building: original image, settings and canonical geometry."""
    v = sess.corrected
    return rn._plain({
        "format": PROJECT_FORMAT, "version": 1, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "filename": sess.filename, "image_b64": base64.b64encode(sess.data).decode("ascii"),
        "config": dict(sess.config),
        "walls": [w.to_dict() for w in v.walls],
        "user_openings": [{k: o[k] for k in ("id", "type", "hosts")} for o in v.openings if o.get("source") == "user"],
        "rooms": [{"id": r["id"], "point": _inside_point(v.labels, k + 1), "name": sess.room_names.get(r["id"])}
                  for k, r in enumerate(v.rooms)],
        "scale": sess.scale if sess.scale["status"] == "manual" else None,
        "next_ids": dict(sess.next_ids),
    })


def import_project(proj: dict):
    """Re-create a session from a saved project (detection runs once; the saved geometry then replaces it)."""
    if not isinstance(proj, dict) or proj.get("format") != PROJECT_FORMAT:
        raise ValueError("this is not an ArchNext project file")
    data = base64.b64decode(proj["image_b64"])
    cfg = proj.get("config", {})
    sess = rn.process_plan(data, proj.get("filename", "project"), cfg.get("topology_guard", True),
                           cfg.get("scale_lock", True), detection=cfg.get("detection", "standard"))
    walls = [Wall(w["id"], w["x1"], w["y1"], w["x2"], w["y2"], w["thickness"], w["orient"], w.get("exterior", False),
                  w.get("source", "auto"), [], w.get("height")) for w in proj["walls"]]
    keep = [{**o, "source": "user", "confidence": "high", "x1": 0, "y1": 0, "x2": 0, "y2": 0, "width": 0,
             "thickness": 0}
            for o in proj.get("user_openings", [])]
    sess.next_ids.update({k: max(int(v), sess.next_ids.get(k, 1)) for k, v in proj.get("next_ids", {}).items()})
    version = rn._rebuild(sess, walls, keep)
    # Saved room ids and names: the room containing each saved interior point gets them back.
    H, W = version.labels.shape
    names, restored = {}, set()
    for saved in proj.get("rooms", []):
        x, y = (int(round(c)) for c in saved["point"])
        if 0 <= x < W and 0 <= y < H and version.labels[y, x] > 0:
            room = version.rooms[version.labels[y, x] - 1]
            if id(room) in restored:
                continue
            room["id"] = saved["id"]
            restored.add(id(room))
            if saved.get("name"):
                names[saved["id"]] = saved["name"]
    # Rooms that did not get a saved id must not collide with one that did.
    saved_ids = {r["id"] for r in version.rooms if id(r) in restored}
    for r in version.rooms:
        if id(r) not in restored and r["id"] in saved_ids:
            r["id"] = rn._new_id(sess, "r", {x["id"] for x in version.rooms})
    sess.room_names = names
    rn.apply_room_names(sess, version)
    sess.corrected = version
    if proj.get("scale"):
        sess.scale = proj["scale"]
    sess.edited = True
    sess.fix_log = [{"check": "manual", "message": "Project reopened", "at": [0.0, 0.0], "walls": [], "kind": "manual"}]
    sess.history.clear()
    sess.redo.clear()
    rn.refresh_issues(sess)
    return sess


__all__ = ["apply_edit", "export_project", "import_project", "EditError"]
