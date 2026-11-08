#!/usr/bin/env python3
"""Build a compact Mari El camera database from SpeedCams.world and live OSM.
Address-only third-party listings are deliberately not geocoded into warning points.
"""
import csv, io, json, math, os, sys, time, re, zlib, urllib.parse, urllib.request
from html.parser import HTMLParser
from datetime import datetime, timezone

CSV_URL = "https://speedcams.world/downloads/ru/ru-all.csv"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS_ENDPOINTS = ["https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.nchc.org.tw/api/interpreter"]
UA = "BMW-Speed-Camera-Warning/0.5.0 (camera database build)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "camera-db.json")
APP = os.path.join(ROOT, "apps", "aurelm_speed_camera_warning", "camera-db.json")

def fetch(url, data=None, timeout=25):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def nominatim_polygon(name):
    q = urllib.parse.urlencode({"q": name, "format": "jsonv2", "polygon_geojson": 1, "limit": 1})
    rows = json.loads(fetch(NOMINATIM + "?" + q).decode("utf-8"))
    if not rows or "geojson" not in rows[0]:
        raise RuntimeError("Nominatim did not return boundary polygon for " + name)
    return rows[0]["geojson"]

def rings(geometry):
    typ, coords = geometry["type"], geometry["coordinates"]
    if typ == "Polygon":
        return coords
    if typ == "MultiPolygon":
        return [ring for polygon in coords for ring in polygon]
    raise RuntimeError("Unsupported boundary geometry: " + typ)

def inside_ring(lon, lat, ring):
    inside, j = False, len(ring) - 1
    for i, p in enumerate(ring):
        x1, y1 = p[0], p[1]; x2, y2 = ring[j][0], ring[j][1]
        if ((y1 > lat) != (y2 > lat)) and lon < (x2-x1)*(lat-y1)/(y2-y1+1e-30)+x1:
            inside = not inside
        j = i
    return inside

def inside_polygon(lon, lat, geometry):
    # GeoJSON Polygon rings: first is outer, subsequent rings are holes.
    for polygon in (geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]):
        if inside_ring(lon, lat, polygon[0]) and not any(inside_ring(lon, lat, h) for h in polygon[1:]):
            return True
    return False

def normalize(row, source, source_url):
    try:
        lat, lon = float(row["latitude"]), float(row["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    raw_limit = (row.get("maxspeed") or "").strip()
    try: limit = int(float(raw_limit)) if raw_limit else None
    except ValueError: limit = None
    if limit is not None and not (5 <= limit <= 250): limit = None
    osm_id = str(row.get("id") or "").strip()
    name = (row.get("name") or row.get("type") or "Камера").strip()[:160]
    kind = (row.get("type") or "Камера").strip()[:80]
    key = osm_id if osm_id else ("%0.6f,%0.6f" % (lat, lon))
    return {"id": "scw-" + key.replace(",", "-"), "name": name, "type": kind,
            "limit": limit, "lat": lat, "lon": lon, "source": source,
            "sourceLabel": "SpeedCams.world / OpenStreetMap", "sourceUrl": source_url,
            "osmId": osm_id or None, "note": "Координаты из опубликованной базы OSM."}

def osm_nodes(geometry):
    allpts = [p for ring in rings(geometry) for p in ring]
    minlon=min(p[0] for p in allpts); maxlon=max(p[0] for p in allpts)
    minlat=min(p[1] for p in allpts); maxlat=max(p[1] for p in allpts)
    bbox = f"{minlat},{minlon},{maxlat},{maxlon}"
    query = f'[out:json][timeout:45];(node["highway"="speed_camera"]({bbox});node["enforcement"="maxspeed"]({bbox}););out body;'
    payload = urllib.parse.urlencode({"data": query}).encode()
    last_error=None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(1):
            try:
                result=json.loads(fetch(endpoint,payload,timeout=12).decode("utf-8"))
                last_error=None
                break
            except Exception as exc:
                last_error=exc
                time.sleep(0.25)
        if last_error is None: break
    if last_error is not None: raise last_error
    out=[]
    for node in result.get("elements", []):
        lat,lon=node.get("lat"),node.get("lon")
        if not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)) or not inside_polygon(lon,lat,geometry): continue
        tags=node.get("tags",{})
        if tags.get("highway") != "speed_camera" and tags.get("enforcement") != "maxspeed": continue
        limit=tags.get("maxspeed","")
        try: limit=int(float(limit.split()[0]))
        except (ValueError,IndexError): limit=None
        typ=tags.get("enforcement") or tags.get("highway") or "Камера"
        name=tags.get("name") or tags.get("ref") or ("Камера контроля скорости" if typ in ("maxspeed","speed_camera") else "Камера контроля перекрёстка")
        out.append({"id":"osm-"+str(node["id"]),"name":name[:160],"type":typ[:80],
            "limit":limit if isinstance(limit,int) and 5<=limit<=250 else None,
            "lat":float(lat),"lon":float(lon),"source":"OpenStreetMap",
            "sourceLabel":"OpenStreetMap","sourceUrl":"https://www.openstreetmap.org/node/"+str(node["id"]),
            "osmId":str(node["id"]),"note":"Объект OSM; статус и фактическое наличие требуют проверки."})
    return out


def osm_snapshot_nodes():
    """Read the dated local Overpass export so rebuilds retain these OSM records."""
    snapshot_path = os.path.join(ROOT, "export-1.geojson")
    if not os.path.exists(snapshot_path):
        return []
    payload = json.load(open(snapshot_path, encoding="utf-8"))
    out = []
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        geometry = feature.get("geometry", {})
        coords = geometry.get("coordinates", [])
        if geometry.get("type") != "Point" or len(coords) < 2:
            continue
        lon, lat = coords[0], coords[1]
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        osm_id = str(props.get("@id") or feature.get("id") or "").replace("node/", "")
        if not osm_id.isdigit():
            continue
        raw_limit = str(props.get("maxspeed") or "").split()[0]
        try: limit = int(float(raw_limit))
        except (ValueError, IndexError): limit = None
        if limit is not None and not (5 <= limit <= 250): limit = None
        description = str(props.get("description") or "").strip()[:500]
        lower = description.lower()
        if re.search(r"светофор|перекр[её]ст|стоп[\\s-]*линия|выезд за стоп", lower):
            category, kind = "intersection", "Камера на перекрёстке"
        elif re.search(r"скорост|скоростн|радар|speed|автоматическ.*контрол", lower):
            category, kind = "speed", "Камера контроля скорости"
        elif not description:
            category, kind = "unknown", "Камера OSM"
        else:
            category, kind = "other", "Камера OSM"
        direction = str(props.get("direction") or "").strip() or None
        out.append({"id":"osm-"+osm_id,"name":(kind + (" " + str(limit) + " км/ч" if limit else ""))[:160],
            "type":kind,"limit":limit,"lat":float(lat),"lon":float(lon),
            "source":"OpenStreetMap-Overpass","sourceLabel":"OpenStreetMap / Overpass (08.11.2026)",
            "sourceUrl":"https://www.openstreetmap.org/node/"+osm_id,"osmId":osm_id,
            "direction":direction,"description":description,"category":category,"overpassSnapshot":True,
            "note":("Описание OSM указывает на перекрёсток/светофор; фактический тип контроля требует проверки."
                    if category == "intersection" else
                    "Лимит скорости в OSM не указан." if limit is None else
                    "Данные из выгрузки Overpass; фактическое наличие требует проверки.")})
    return out


def merge_osm_snapshot(cameras, snapshot):
    """Enrich existing OSM IDs and add distinct nodes without proximity-dropping opposite directions."""
    by_osm = {str(c.get("osmId")): c for c in cameras if c.get("osmId")}
    added = 0
    for incoming in snapshot:
        osm_id = incoming["osmId"]
        current = by_osm.get(osm_id)
        if current is not None:
            current["direction"] = incoming.get("direction")
            current["description"] = incoming.get("description") or current.get("description", "")
            current["category"] = incoming.get("category", "unknown")
            current["overpassSnapshot"] = True
            if incoming.get("limit") is not None:
                current["limit"] = incoming["limit"]
            if incoming.get("category") == "intersection":
                current["type"] = "Камера на перекрёстке"
            elif incoming.get("category") == "speed":
                current["type"] = "Камера контроля скорости"
            current["osmSourceUrl"] = incoming["sourceUrl"]
        else:
            cameras.append(incoming)
            by_osm[osm_id] = incoming
            added += 1
    return cameras, added

def dedupe(items):
    result=[]; ids=set()
    for c in items:
        if not c or c["id"] in ids: continue
        ids.add(c["id"])
        duplicate=False
        for old in result:
            if old.get("osmId") and c.get("osmId") and old["osmId"]==c["osmId"]:
                duplicate=True; break
            # Co-located source records: retain the record with an OSM ID/source priority.
            dlat=(old["lat"]-c["lat"])*111320
            dlon=(old["lon"]-c["lon"])*111320*math.cos(math.radians(c["lat"]))
            if dlat*dlat+dlon*dlon < 25*25:
                if c.get("osmId") and not old.get("osmId"):
                    result[result.index(old)] = c
                duplicate=True; break
        if not duplicate: result.append(c)
    return result


class HelpRadarParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.in_row=False; self.in_cell=False; self.cell=""; self.row=[]; self.rows=[]
    def handle_starttag(self, tag, attrs):
        if tag == "tr": self.in_row=True; self.row=[]
        elif tag in ("td","th") and self.in_row: self.in_cell=True; self.cell=""
    def handle_data(self, data):
        if self.in_cell: self.cell += data
    def handle_endtag(self, tag):
        if tag in ("td","th") and self.in_cell:
            self.row.append(" ".join(self.cell.split())); self.in_cell=False
        elif tag == "tr" and self.in_row:
            if self.row: self.rows.append(self.row)
            self.in_row=False

def helpradar_candidates():
    url = "https://helpradar.ru/kamery-gibdd/ioshkar-ola"
    parser = HelpRadarParser()
    parser.feed(fetch(url, timeout=20).decode("utf-8", "replace"))
    result=[]; seen=set()
    for row in parser.rows:
        if not row: continue
        address=row[0].strip()
        if not address or address.lower() in ("адрес","-","—"): continue
        if len(row)>1 and row[1].strip().lower() in ("ограничение скорости","скорость"): continue
        key=re.sub(r"[^а-яa-z0-9]+"," ",address.lower()).strip()
        if not key or key in seen: continue
        seen.add(key)
        limit=None
        if len(row)>1:
            m=re.search(r"\b(\d{2,3})\b",row[1])
            if m:
                n=int(m.group(1)); limit=n if 5<=n<=250 else None
        ident="hr-"+format(zlib.crc32(key.encode("utf-8")) & 0xffffffff,"08x")
        result.append({"id":ident,"name":address[:160],"type":"Камера / адрес из стороннего списка",
            "limit":limit,"lat":None,"lon":None,"source":"HelpRadar-SpeedCamOnline",
            "sourceLabel":"HelpRadar / SpeedCamOnline","sourceUrl":url,"osmId":None,
            "note":"Адрес из стороннего списка; точные координаты устройства не подтверждены. Не участвует в GPS-предупреждениях."})
    return result

def main():
    region=nominatim_polygon("Республика Марий Эл, Россия")
    city=nominatim_polygon("Йошкар-Ола, Республика Марий Эл, Россия")
    raw=fetch(CSV_URL,timeout=45).decode("utf-8-sig")
    rows=list(csv.DictReader(io.StringIO(raw)))
    speed_region=[]; speed_city=[]
    for row in rows:
        if (row.get("country_code") or "").upper() != "RU": continue
        c=normalize(row,"SpeedCams.world","https://speedcams.world/download/russia")
        if not c: continue
        if inside_polygon(c["lon"],c["lat"],region):
            speed_region.append(c)
            if inside_polygon(c["lon"],c["lat"],city): speed_city.append(c)
    try:
        live_region=osm_nodes(region)
    except Exception as exc:
        print("WARNING: live Overpass import unavailable; SpeedCams.world OSM snapshot remains active:",exc,file=sys.stderr)
        live_region=[]
    live_city=[c for c in live_region if inside_polygon(c["lon"],c["lat"],city)]
    # Preserve the manually curated local entries; null-coordinate entries remain visible
    # but cannot generate proximity alerts.
    old={}
    try:
        old=json.load(open(DATA,encoding="utf-8"))
        next_revision=max(3,int(old.get("revision",2))+1)
        manual=[c for c in old.get("cities",{}).get("yoshkar-ola",[]) if c.get("id","").startswith("yola-") or c.get("source")=="local-curated"]
    except Exception:
        next_revision=3
        manual=[]
    for c in manual:
        c["source"]="local-curated"; c.setdefault("sourceLabel","Подборка Йошкар-Олы")
        c.setdefault("sourceUrl","https://www.driver-helper.ru/kamery-gibdd/joshkar_ola")
    region_cameras=dedupe(speed_region+live_region)
    manual_geo=[c for c in manual if isinstance(c.get("lat"),(int,float)) and isinstance(c.get("lon"),(int,float))]
    manual_unlocated=[c for c in manual if c not in manual_geo]
    city_cameras=dedupe(speed_city+live_city+manual_geo)+manual_unlocated
    snapshot_nodes=osm_snapshot_nodes()
    city_cameras, snapshot_added=merge_osm_snapshot(city_cameras,snapshot_nodes)
    try:
        third_party=helpradar_candidates()
    except Exception as exc:
        print("WARNING: HelpRadar import unavailable; coordinate-backed sources remain active:",exc,file=sys.stderr)
        third_party=[]
    known_names={re.sub(r'[^а-яa-z0-9]+',' ',c['name'].lower()).strip() for c in city_cameras}
    city_cameras += [c for c in third_party if re.sub(r'[^а-яa-z0-9]+',' ',c['name'].lower()).strip() not in known_names]
    updated_at=datetime.now(timezone.utc).isoformat()
    if old and old.get("cities")=={"mari-el":region_cameras,"yoshkar-ola":city_cameras,"moscow":[],"sochi":[]} and old.get("sourceCounts")=={"mari-el":{"speedcams":len(speed_region),"osm":len(live_region)},"yoshkar-ola":{"speedcams":len(speed_city),"osm":len(live_city),"local":len(manual),"helpradar":len(third_party)}}:
        next_revision=int(old.get("revision",next_revision))
        updated_at=old.get("updatedAt") or updated_at
    db={"schemaVersion":1,"revision":next_revision,"updatedAt":updated_at,
        "attribution":"© OpenStreetMap contributors; ODbL 1.0. SpeedCams.world data is derived from OpenStreetMap.",
        "overpassSnapshot":{"source":"OpenStreetMap / Overpass","timestamp":json.load(open(os.path.join(ROOT,"export-1.geojson"),encoding="utf-8")).get("timestamp") if snapshot_nodes else None,
                            "count":len(snapshot_nodes),"added":snapshot_added},
        "cities":{"mari-el":region_cameras,"yoshkar-ola":city_cameras,"moscow":[],"sochi":[]},
        "sourceCounts":{"mari-el":{"speedcams":len(speed_region),"osm":len(live_region)},
                        "yoshkar-ola":{"speedcams":len(speed_city),"osm":len(live_city),"local":len(manual),"helpradar":len(third_party)}}}
    for path in (DATA,APP):
        os.makedirs(os.path.dirname(path),exist_ok=True)
        with open(path,"w",encoding="utf-8") as f: json.dump(db,f,ensure_ascii=False,indent=2)
    print("Mari El cameras:",len(region_cameras),"SpeedCams:",len(speed_region),"OSM:",len(live_region))
    print("Yoshkar-Ola cameras:",len(city_cameras),"SpeedCams:",len(speed_city),"OSM:",len(live_city),"local:",len(manual),"HelpRadar:",len(third_party))
    if not region_cameras or not city_cameras:
        raise RuntimeError("Source import returned an empty regional or city dataset")

if __name__ == "__main__": main()
