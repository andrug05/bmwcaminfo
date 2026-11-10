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

# MapCam RUS offline snapshot (permission granted by data provider).
# Compact rows: id, lat, lon, type_key, speed_limit, direction_type, approach_heading_deg, warning_distance_m.
MAPCAM_ROWS_B64 = "eNqVWu2uHLcNfRf/XhgSKZLiswRBUCR2ayBtgtQ/8vg9ksjZuV7tzjZAEtj3Ho6GH4eH1Pz0U+3SrNBN9LNwb9Tt1uyz916t3T59/+sfX79++WXX//4z/e//vgd///3n79/+fvTzcqt3ir1W/Py8y2s1LSijcIKVfUrM1zlpmWaEeeqywzsAb7MUO3Gt09fv/395bdf/vvnly+/fbq1eYJ+4xOyBJJa9UBSwRvtkG43lnV2x9GXB0SLaR9QvFDFCa7OrjcpdyMcRioOEEaKslz60cthRlov6zWsF1sO6FYb/v3hNSaUEK5A1l6oBZIaayCFyx5Z/H52NdcJ9e7jBwPahenB6zrPK46gtQNqCWXqF1Bmz4hVVSvrwO4VIZ4Rs+pCLxy2DqBynJ2U2dJKk/a+FUaQDivGND2A2MEFbTmvSNunHX6BT0gLpJdGr5Fc2v39e10lo5XN1utrwU/b1nOUCUvWZvAWsPuBJGT9Nlz39+ymFqeVXvqqkqJStO6OSzCOSjmgPaFU7AJaEdAqdNRGWVBVb8u7vdXStklCdHh3IMNHauSRXq3UvnUSlRpQJ2TXeiahGmjWo7PLqOmNj/CUoINSpbAnsrEn0mh/2s54Jg+o11FuC8qEXx+nraWAE39AynwozhLVO5CqiWyqCcUfdlDq/aAv5IO0gIqAblr/XFobVPYD1OdTTU9p30QeoeAb30FZNCOjDGazgGqzxRmOvK+6j2lHdA6opJcsXhWZ5HUbGhRyZR1AQ2kqLWBTa+uZgoTyV71qZTIzgizTjKjQYca7hBm8P12ZgaPregvDS9RVD6Aga7MeOntHILelhANQQq1FVn+Esm1LCSGqK9amjq6YSABWPZTm3rZFCD6KhxJp75HWqryKEGnX25Y00A+IV2ftaEm6Afqebgbzoxsdx7WESlRvqe5bbkTB1CUnnMgtQgRv1dVNG/RJ2ZMNiIRaP6CcUA/nAvqYmPen2qK4gtqLcuisvhLD8E+7bCb4ZXSfw0pLK5AlaYWhDy6sAIlk98NMvAcIL5LdIE96u+xsNFifjxKPYnM0iJUxjmZV5LLN4sD1TjKtp5lGUe4Cfr54qZGARxJOM74xM2v/wjfIXnhl5hWKL3oR1M2QRtM3I8P7NsbI1Jo6EeReE+rhVbKKQz5JLGiT1RfYdQWExx949QWohb5nPM1snkhLpFEitbk962JRQZA3PVKS8VeSzagR7Rt29j+EegR7AUFKy0UdP3S/9DQaZ8Qd8p3SXR/MQP9dmwkrOItYSSMeUX/PSK0fzmKLiBhHjMp+8yx+mAH/DCExzYDNmiyXItlRw5/+gkN///bPf31PYD0ENsJYIoogag2YGoLyCOuHzp24ljiLxxVBO3vE1SG+5Y4Lr7VCS1rjgSMjNg/Erx5agmOeAVBtjUKgkPl+u8aE8rSp5o3RVcPDIoP1xyMJXA8Wu6jyUUvxxtOMPZrByf3STDlGOnQP4TiNTlk82yQM8rNSPSNtg6Qmz3pAzpFNBqVN6GCZ6HbUxeSdujmbkTTjNax4eYd1T1Yapwcw1LbjMKz1Hbo8H6amGYwdeZrG7xRx5nHraERhRXT1NdOCMeLVO025CobUk5V0jISGgxUbY/prIzSk4sHiLUYglBQtHWQKBWcfa1hmAwL50mIigvJLnNfVOKBRpD0kxj0WlnyaHA69pTE5oeHYXgWBcEgshhg8LKBoy8txpq30S73Z9UQjh+N61eU4h0ZD/3k2RB37Dc5u2VEbls8niLwr2aynYQGZkx6AGFi+IzCSbPvfoLIzIUTqdOE1O3Zv6PpvEALelOthhjdm9Eo9LHqitbNwjJSangRThCeH+t4PlSculzmwLCgAoRAdBG37+Rn/7VOXKviv14Tq6qQKR7aiu/1MP9YzA3nkD7SKXyAJyanH/IxsXdCRv6sVYKjkl7JtpZ6dpnDOo0NVVEkrxvROArWT88LvjlFyhc9E8H77DUJN3YipvWbkETCK8Rj0uIeOp+a0OXq0PkANT73mUIg/ndGrg6zSkVqWaHhxgP7x+ek8TJsrBDDrvb9R/SFaSh81F1YgVldLxQCqtp82IRpjqoGuYfeEjh8EtO0XN0NXyXF0O5AtPNfHvvYy6hKMu4ws2kAeSGwIUctoi5f+rx9VWwkzFJsgJCPK0S/YZzJnngAno4D2OZC9rndELPpMG5u52FXo0DXP1kjtVDQcUMFwujQIhh3jd4rmXHuUZjDG/h9m7s0DXM/Ruxs8U9eWcmy0nPZrSstZa0IloLVwIAu1LeNB6kTgka8Ue7RWI+xGZa/ATtIJ57PKP+KgaX2/is3JbsQqtoxjdR/jAQZUbdspq36IcuxjgBxrrRVlt77v7aUceqKUlmc19xiPvM3N5oXOK8dGbEw2mgfoHOwyOlup74hOypHPpTxakVr1DZl3MpJvNG6BwojqexN6rrggLkukLSN0S7lS0cLbYGAQhi9zyZdpw62KBHIsgXaxkHIknINU85naNWZ7dyV/1l+YKUkqixViuUbWocX26zhOrpeD66PMmsWgDzO9cn1r2bJW7fM0EUhogJ5maGiPy0G3njtPtO0mGL7SDAaT/nY+rBspDSuSXcDHSH/Zv6boWg10mMnqBHvEHYAT1eul6+ByKKDcYrqlmWAHzO4km5mQRgs8v0cW+YHECKDtWgTPzZMHqbV2WLHoJQjR/rbn1A6GG3sCe1AM6JAvQ1qHci3H0ymNDAGxnk7liYIao73coZGaBhUXdzDM8lLDUfo/SXZYiUKxFkoQVsa8f2FlelH1aA1xGFR73LhyUX9yDYXjnrsKP0Kt1/1SWXL2m8zSVgpKqUeDkOJFL3eY8DXGr4PaOM2Mi+k1hXTTt4aQIEgbPLOsoOWllVJG738mhuUOpYSqHlB9suC5U8J0wSJXIZMeG3n8Pe3vD4YAWxQ5X7sl1EIKjc8E2J+OPiTH5BhQpErcxWFYhwZ74TLP7dTpwjgWsDDT42JOuPnLjfg0M1racfvEwQPCWpYHtBc0j11/gf6l9RYVpVLz8aM3BRIvJ/vONOpWj6pZGkq0xpUixiFwwhYKzxy0NaCaUI2Jc1xV2bYf1jECsoRyK9GDwTgacy6GB3kYVud+RY6vECaSE2lmicS0v72N5OMiExYkFLOMvFrnxUiqtH/V+96yj5VEInvjRHbeK/yxmroPB3G3pUwia8He0ccfhoP1pn5a6lJcqAFpcSEOJD0cd70pcjumowpdTiuRFLEJMnYaa8arLz7GZwrlboXSSu5KYYXVrqxMIrz3+rgEVsRrEbOOm9a+v+8WPUO7JrSve40B9YcrkfiE4wi2Dlke3hshm93QfNwY9u3VM9cPUEuoayLtYbnr+d2E5kUmlRAkvbBGB+b59ctW5h+73YmUR6TuSx/FflyxK842ga7NxyzXP0PLqlzz1xCB5W6lhRUpYzHyrpXGp++MaK0zUI7weJtGOnLO+m4Z1OQDUhIp4wulhcSAtF0jkZy+SopPdTCZza9WRrREur9s+yvm0Eh6MsNphtecBTPOL1vn+kgMfUCyD1SpywU0P5xYE0Ib25g9xQRyfNexrlQHkK9wY/vAJ/U0E32sbWssX6HxX8u35QBwPJ/I3Ddm0MgvO9h8iJZ//ByijFZk="
MAPCAM_TYPE_NAMES = {"fixed_speed":"Стационарная камера скорости","red_light":"Контроль проезда на красный","traffic_control_complex":"Комплекс контроля ПДД"}

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
        if re.search(r"светофор|перекр[её]ст|стоп[\s-]*линия|выезд за стоп", lower):
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

def mapcam_cameras():
    rows = json.loads(zlib.decompress(__import__("base64").b64decode(MAPCAM_ROWS_B64)).decode("utf-8"))
    result = []
    for row in rows:
        ident, lat, lon, type_key, limit, direction_type, heading, warning_distance = row
        travel = ([float(heading)] if direction_type == 1 and heading is not None else
                  [float(heading), (float(heading) + 180.0) % 360.0] if direction_type == 2 and heading is not None else [])
        name = MAPCAM_TYPE_NAMES[type_key]
        result.append({"id":"mapcam-"+str(ident),"name":name,"type":name,"limit":limit,
            "lat":float(lat),"lon":float(lon),"source":"MapCam.info",
            "sourceLabel":"MapCam.info RUS snapshot (2025-11-13)",
            "sourceUrl":"https://mapcam.info/","mapcamId":int(ident),"mapcamType":type_key,
            "mapcamDirectionType":int(direction_type),"mapcamApproachHeadingDeg":heading,
            "mapcamTravel":travel,"mapcamWarningDistanceM":warning_distance,
            "note":"Разрешённая офлайн-выгрузка MapCam.info от 2025-11-13; направление контроля сохранено."})
    return result

def merge_mapcam(cameras, incoming):
    added = merged = 0
    for item in incoming:
        best = None
        for current in cameras:
            if current.get("mapcamId") is not None or not isinstance(current.get("lat"), (int,float)) or not isinstance(current.get("lon"), (int,float)):
                continue
            dy = (current["lat"] - item["lat"]) * 111320
            dx = (current["lon"] - item["lon"]) * 111320 * math.cos(math.radians(item["lat"]))
            distance = math.hypot(dx, dy)
            if distance <= 12 and (best is None or distance < best[0]): best = (distance, current)
        if best:
            current = best[1]
            for key in ("mapcamId","mapcamType","mapcamDirectionType","mapcamApproachHeadingDeg","mapcamTravel","mapcamWarningDistanceM"):
                current[key] = item[key]
            current["additionalSources"] = sorted(set(current.get("additionalSources", []) + ["MapCam.info"]))
            if current.get("limit") is None: current["limit"] = item.get("limit")
            merged += 1
        else:
            cameras.append(item); added += 1
    return cameras, added, merged

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
    mapcam_rows=mapcam_cameras()
    city_cameras, mapcam_added, mapcam_merged = merge_mapcam(city_cameras, mapcam_rows)
    try:
        third_party=helpradar_candidates()
    except Exception as exc:
        print("WARNING: HelpRadar import unavailable; coordinate-backed sources remain active:",exc,file=sys.stderr)
        third_party=[]
    known_names={re.sub(r'[^а-яa-z0-9]+',' ',c['name'].lower()).strip() for c in city_cameras}
    city_cameras += [c for c in third_party if re.sub(r'[^а-яa-z0-9]+',' ',c['name'].lower()).strip() not in known_names]
    updated_at=datetime.now(timezone.utc).isoformat()
    if old and old.get("cities")=={"mari-el":region_cameras,"yoshkar-ola":city_cameras,"moscow":[],"sochi":[]} and old.get("sourceCounts")=={"mari-el":{"speedcams":len(speed_region),"osm":len(live_region)},"yoshkar-ola":{"speedcams":len(speed_city),"osm":len(live_city),"local":len(manual),"mapcam":len(mapcam_rows),"mapcamAdded":mapcam_added,"mapcamMerged":mapcam_merged,"helpradar":len(third_party)}}:
        next_revision=int(old.get("revision",next_revision))
        updated_at=old.get("updatedAt") or updated_at
    db={"schemaVersion":1,"revision":next_revision,"updatedAt":updated_at,
        "attribution":"© OpenStreetMap contributors; ODbL 1.0. SpeedCams.world data is derived from OpenStreetMap. MapCam.info RUS snapshot 2025-11-13 included under permission granted by the provider.",
        "overpassSnapshot":{"source":"OpenStreetMap / Overpass","timestamp":json.load(open(os.path.join(ROOT,"export-1.geojson"),encoding="utf-8")).get("timestamp") if snapshot_nodes else None,
                            "count":len(snapshot_nodes),"added":snapshot_added},
        "cities":{"mari-el":region_cameras,"yoshkar-ola":city_cameras,"moscow":[],"sochi":[]},
        "sourceCounts":{"mari-el":{"speedcams":len(speed_region),"osm":len(live_region)},
                        "yoshkar-ola":{"speedcams":len(speed_city),"osm":len(live_city),"local":len(manual),"mapcam":len(mapcam_rows),"mapcamAdded":mapcam_added,"mapcamMerged":mapcam_merged,"helpradar":len(third_party)}}}
    for path in (DATA,APP):
        os.makedirs(os.path.dirname(path),exist_ok=True)
        with open(path,"w",encoding="utf-8") as f: json.dump(db,f,ensure_ascii=False,indent=2)
    print("Mari El cameras:",len(region_cameras),"SpeedCams:",len(speed_region),"OSM:",len(live_region))
    print("Yoshkar-Ola cameras:",len(city_cameras),"SpeedCams:",len(speed_city),"OSM:",len(live_city),"local:",len(manual),"MapCam:",len(mapcam_rows),"added:",mapcam_added,"merged:",mapcam_merged,"HelpRadar:",len(third_party))
    if not region_cameras or not city_cameras:
        raise RuntimeError("Source import returned an empty regional or city dataset")

if __name__ == "__main__": main()
