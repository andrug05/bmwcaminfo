#!/usr/bin/env python3
"""Build compact, offline OSM road geometry around every geocoded Mari El camera.

Only highway geometry is imported. maxspeed tags are deliberately never queried,
parsed, or written. A camera is associated with its nearest road within 30 m;
nearby intersecting/parallel roads are retained to let the runtime reject ambiguity.
"""
import json, math, os, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "apps", "aurelm_speed_camera_warning")
DB_PATH = os.path.join(APP, "camera-db.json")
OUT_PATH = os.path.join(APP, "road-zones.json")
ENDPOINTS = ["https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.nchc.org.tw/api/interpreter"]
UA = "BMW-Speed-Camera-Warning/0.7.0 (offline road geometry build)"
ROAD_FILTER = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road|track)$'
RADIUS_M = 800
ROAD_NEAR_CAMERA_M = RADIUS_M + 50
CAMERA_SNAP_M = 30

def fetch(endpoint, payload):
    req = urllib.request.Request(endpoint, data=payload, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=14) as response:
        return json.loads(response.read().decode("utf-8"))

def local(lon, lat, origin):
    return ((lon-origin["lon"])*111320*math.cos(math.radians(origin["lat"])), (lat-origin["lat"])*111320)

def project(points):
    best = None
    cumulative = 0.0
    for i in range(1, len(points)):
        ax, ay = points[i-1]; bx, by = points[i]
        dx, dy = bx-ax, by-ay
        length = math.hypot(dx, dy)
        if length <= 0:
            continue
        t = max(0.0, min(1.0, -(ax*dx+ay*dy)/(length*length)))
        error = math.hypot(ax+t*dx, ay+t*dy)
        item = {"error": error, "s": cumulative+t*length, "bearing": (math.degrees(math.atan2(dx,dy))+360)%360}
        if best is None or error < best["error"]:
            best = item
        cumulative += length
    return best

def road_points(way, origin):
    geom = way.get("geometry") or []
    pts = [local(p["lon"], p["lat"], origin) for p in geom if isinstance(p.get("lat"), (int,float)) and isinstance(p.get("lon"), (int,float))]
    if len(pts) < 2:
        return []
    # Keep a little beyond the maximum alert radius so the road projection is stable.
    kept = [p for p in pts if math.hypot(p[0],p[1]) <= RADIUS_M+100]
    if len(kept) < 2:
        return []
    # Remove accidental gaps caused by clipping long ways far from the camera.
    out=[]; last=None
    for p in kept:
        if last is not None and math.hypot(p[0]-last[0],p[1]-last[1]) > 350:
            if len(out) >= 2:
                yield out
            out=[]
        out.append(p); last=p
    if len(out) >= 2:
        yield out

def main():
    db = json.load(open(DB_PATH, encoding="utf-8"))
    cameras = {}
    for section in ("mari-el", "yoshkar-ola"):
        for camera in db.get("cities", {}).get(section, []):
            if isinstance(camera.get("lat"), (int,float)) and isinstance(camera.get("lon"), (int,float)):
                cameras.setdefault(camera["id"], camera)
    items = list(cameras.values())
    zones = []
    failed = []
    for start in range(0, len(items), 8):
        batch = items[start:start+8]
        clauses = []
        for c in batch:
            clauses.append('way["highway"~"%s"](around:%d,%.7f,%.7f);' % (ROAD_FILTER,RADIUS_M,c["lat"],c["lon"]))
        query = "[out:json][timeout:10];(" + "".join(clauses) + ");out tags geom;"
        payload = urllib.parse.urlencode({"data":query}).encode()
        result = None; errors = []
        # Race independent Overpass mirrors: the slowest mirror must not add
        # another full timeout to every batch.
        with ThreadPoolExecutor(max_workers=len(ENDPOINTS)) as pool:
            futures = {pool.submit(fetch, endpoint, payload): endpoint for endpoint in ENDPOINTS}
            for future in as_completed(futures):
                try:
                    result = future.result()
                    for pending in futures:
                        if pending is not future: pending.cancel()
                    break
                except Exception as exc:
                    errors.append(f"{futures[future]}: {exc}")
        if result is None:
            failed.extend(c["id"] for c in batch)
            detail = "; ".join(errors[:2]) or "all Overpass mirrors unavailable"
            print("Road geometry batch failed",start+1,"-",min(start+len(batch),len(items)),":",detail,file=sys.stderr)
            # Repeatedly retrying every remaining batch cannot recover from a
            # regional Overpass outage; fail immediately instead of burning minutes.
            raise RuntimeError("Overpass mirrors unavailable; stopped after first failed batch. " + detail)
        ways = result.get("elements", [])
        for camera in batch:
            candidates=[]
            for way in ways:
                tags=way.get("tags") or {}
                if tags.get("highway") not in ("motorway","trunk","primary","secondary","tertiary","unclassified","residential","service","living_street","road","track"):
                    continue
                best_way=None
                for pts in road_points(way,camera):
                    hit=project(pts)
                    if hit and hit["error"] <= ROAD_NEAR_CAMERA_M:
                        item=(hit["error"],way,pts,hit)
                        if best_way is None or item[0] < best_way[0]:
                            best_way=item
                if best_way:
                    candidates.append(best_way)
            if not candidates:
                continue
            candidates.sort(key=lambda x:x[0])
            main_road=next((x for x in candidates if x[0] <= CAMERA_SNAP_M),None)
            if not main_road:
                continue
            # If the camera position is equally close to two different roads,
            # its road association is ambiguous. Do not guess at junctions.
            if len(candidates)>1 and candidates[1][0]-candidates[0][0] < 8:
                continue
            roads=[]; travel=[]
            main_id=str(main_road[1]["id"])
            for error,way,pts,hit in candidates:
                # Avoid duplicate fragments of the same OSM way for this camera.
                way_id=str(way["id"])
                if any(r["id"]==way_id for r in roads):
                    continue
                tags=way.get("tags") or {}
                oneway=tags.get("oneway")
                direction=-1 if oneway=="-1" else 1 if oneway in ("yes","1","true") else 0
                cam_m=hit["s"] if way_id==main_id else None
                roads.append({"id":way_id,"pts":[[int(round(x)),int(round(y))] for x,y in pts],
                    "camM":round(cam_m,2) if cam_m is not None else None,"dir":direction})
                if way_id==main_id:
                    forward=hit["bearing"]
                    travel=[round((forward+(180 if direction==-1 else 0))%360,1)]
                    if direction==0:
                        travel.append(round((forward+180)%360,1))
            if roads and travel:
                zones.append({"id":camera["id"],"lat":camera["lat"],"lon":camera["lon"],"roads":roads,"travel":travel})
        print("Road geometry:", min(start+len(batch),len(items)), "/",len(items), "cameras; zones:",len(zones), "failed:",len(failed))
        # Persist successful batches; final coverage gate still blocks weak releases.
        checkpoint={
            "schemaVersion":1,"region":"RU-ME",
            "source":"OpenStreetMap contributors (ODbL 1.0)",
            "databaseRevision":db.get("revision"),"radiusM":RADIUS_M,
            "cameraCount":len(items),"zoneCount":len(zones),
            "failedCameraIds":failed,"zones":zones
        }
        with open(OUT_PATH,"w",encoding="utf-8") as f:
            json.dump(checkpoint,f,ensure_ascii=False,separators=(",",":"))
    if len(zones) < max(1, int(len(items)*0.20)):
        raise RuntimeError("Too few road-confirmed camera zones (%d/%d); refusing to publish a low-coverage geometry file" % (len(zones),len(items)))
    payload={"schemaVersion":1,"region":"RU-ME","source":"OpenStreetMap contributors (ODbL 1.0)",
        "databaseRevision":db.get("revision"),"radiusM":RADIUS_M,"cameraCount":len(items),
        "zoneCount":len(zones),"failedCameraIds":failed,"zones":zones}
    encoded=json.dumps(payload,ensure_ascii=False,separators=(",",":"))
    if len(encoded.encode("utf-8")) > 20*1024*1024:
        raise RuntimeError("Road geometry exceeds the 20 MiB safety limit")
    with open(OUT_PATH,"w",encoding="utf-8") as f:
        f.write(encoded)
    print("Wrote",len(zones),"road-confirmed camera zones;",len(encoded.encode("utf-8")),"bytes")

if __name__ == "__main__":
    main()
