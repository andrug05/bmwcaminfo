#!/usr/bin/env python3
"""Build an offline Yoshkar-Ola street layer from OpenStreetMap ways."""
import json, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "apps", "aurelm_speed_camera_warning")
MAP_PATH = os.path.join(BASE, "city-map.json")
ENDPOINTS = ["https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.nchc.org.tw/api/interpreter"]
UA = "BMW-Speed-Camera-Warning/0.5.5 (offline street map)"

def fetch(endpoint, payload):
    req = urllib.request.Request(endpoint, data=payload, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))

def inside(lon, lat, ring):
    hit, j = False, len(ring) - 1
    for i, p in enumerate(ring):
        x1, y1 = p[0], p[1]
        x2, y2 = ring[j][0], ring[j][1]
        if ((y1 > lat) != (y2 > lat)) and lon < (x2-x1)*(lat-y1)/(y2-y1+1e-30)+x1:
            hit = not hit
        j = i
    return hit

def main():
    with open(MAP_PATH, encoding="utf-8") as f:
        data = json.load(f)
    # Yoshkar-Ola municipal boundary from Nominatim; road geometry is fetched at build time.
    q = urllib.parse.urlencode({"q": "Йошкар-Ола, Республика Марий Эл, Россия", "format": "jsonv2", "polygon_geojson": 1, "limit": 1})
    req = urllib.request.Request("https://nominatim.openstreetmap.org/search?" + q, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as response:
        places = json.loads(response.read().decode("utf-8"))
    if not places or "geojson" not in places[0]:
        raise RuntimeError("Nominatim returned no Yoshkar-Ola boundary")
    geom = places[0]["geojson"]
    polygons = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    outer_rings = [poly[0] for poly in polygons]
    all_points = [p for ring in outer_rings for p in ring]
    south, west = min(p[1] for p in all_points), min(p[0] for p in all_points)
    north, east = max(p[1] for p in all_points), max(p[0] for p in all_points)
    bbox = f"{south},{west},{north},{east}"
    query = f'[out:json][timeout:25];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|road)$"]({bbox});out tags geom;'
    payload = urllib.parse.urlencode({"data": query}).encode()
    result = None
    last_error = None
    for endpoint in ENDPOINTS:
        for attempt in range(1):
            try:
                result = fetch(endpoint, payload)
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                time.sleep(0.25)
        if result is not None:
            break
    if result is None:
        raise RuntimeError("Overpass street import failed: " + str(last_error))
    roads = []
    seen = set()
    for way in result.get("elements", []):
        tags = way.get("tags", {})
        points = way.get("geometry", [])
        name = (tags.get("name") or tags.get("ref") or tags.get("highway") or "Улица")[:100]
        for a, b in zip(points, points[1:]):
            midlon = (a["lon"] + b["lon"]) / 2
            midlat = (a["lat"] + b["lat"]) / 2
            if not any(inside(midlon, midlat, ring) for ring in outer_rings):
                continue
            # Keep short, local segments; the app renders each segment directly.
            if abs(a["lon"]-b["lon"]) + abs(a["lat"]-b["lat"]) > 0.02:
                continue
            row = [name, float(a["lat"]), float(a["lon"]), float(b["lat"]), float(b["lon"])]
            key = tuple(round(v, 6) if isinstance(v, float) else v for v in row[1:])
            if key in seen:
                continue
            seen.add(key)
            roads.append(row)
    if len(roads) < 100:
        raise RuntimeError(f"OSM street layer unexpectedly small ({len(roads)} segments); preserving previous map")
    data["roads"] = roads
    data["source"] = "OpenStreetMap contributors (ODbL); offline street geometry imported at build time."
    data["roadSegments"] = len(roads)
    with open(MAP_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Imported {len(roads)} OSM street segments for Yoshkar-Ola")

if __name__ == "__main__":
    main()
