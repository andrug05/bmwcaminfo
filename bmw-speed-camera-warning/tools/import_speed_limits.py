#!/usr/bin/env python3
"""Import numeric OSM maxspeed tags as offline, per-way road segments for Mari El."""
import json, os, re, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP=os.path.join(ROOT,"apps","aurelm_speed_camera_warning")
OUT=os.path.join(APP,"speed-limits.json")
ENDPOINTS=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"]
UA="BMW-Speed-Camera-Warning/0.5.8 (offline OSM maxspeed importer)"

def fetch(url,data=None,timeout=90):
    req=urllib.request.Request(url,data=data,headers={"User-Agent":UA,"Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=timeout) as r:return r.read()

def polygon(name):
    q=urllib.parse.urlencode({"q":name,"format":"jsonv2","polygon_geojson":1,"limit":1})
    rows=json.loads(fetch("https://nominatim.openstreetmap.org/search?"+q,timeout=45).decode())
    if not rows or "geojson" not in rows[0]:raise RuntimeError("No boundary polygon: "+name)
    g=rows[0]["geojson"]
    return g["coordinates"] if g["type"]=="MultiPolygon" else [g["coordinates"]]

def inside(lon,lat,rings):
    for poly in rings:
        ring=poly[0];hit=False;j=len(ring)-1
        for i,p in enumerate(ring):
            x1,y1=p[0],p[1];x2,y2=ring[j][0],ring[j][1]
            if ((y1>lat)!=(y2>lat)) and lon<(x2-x1)*(lat-y1)/(y2-y1+1e-30)+x1:hit=not hit
            j=i
        if hit:return True
    return False

def numeric_limit(raw):
    if not raw:return None
    m=re.match(r"^\\s*(\\d+(?:\\.\\d+)?)\\s*(mph)?\\s*$",raw,re.I)
    if not m:return None
    n=float(m.group(1))*(1.609344 if m.group(2) else 1)
    return int(round(n)) if 5<=n<=250 else None

def main():
    region=polygon("Республика Марий Эл, Россия")
    city=polygon("Йошкар-Ола, Республика Марий Эл, Россия")
    pts=[p for poly in region for p in poly[0]]
    south,west=min(p[1] for p in pts),min(p[0] for p in pts)
    north,east=max(p[1] for p in pts),max(p[0] for p in pts)
    bbox=f"{south},{west},{north},{east}"
    query=f'[out:json][timeout:90];way["highway"]["maxspeed"]({bbox});out tags geom;'
    payload=urllib.parse.urlencode({"data":query}).encode()
    result=None;error=None
    for endpoint in ENDPOINTS:
        for attempt in range(2):
            try:result=json.loads(fetch(endpoint,payload).decode());error=None;break
            except Exception as e:error=e;time.sleep(2+attempt*3)
        if result is not None:break
    if result is None:raise RuntimeError("Overpass maxspeed import failed: "+str(error))
    segments=[];seen=set();city_count=0
    for way in result.get("elements",[]):
        tags=way.get("tags",{});limit=numeric_limit(tags.get("maxspeed"))
        if limit is None:continue
        geom=way.get("geometry",[])
        name=(tags.get("name") or tags.get("ref") or tags.get("highway") or "Дорога")[:100]
        highway=tags.get("highway","")
        for a,b in zip(geom,geom[1:]):
            lon=(a["lon"]+b["lon"])/2;lat=(a["lat"]+b["lat"])/2
            if not inside(lon,lat,region):continue
            row={"id":"osm-way-"+str(way["id"])+"-"+str(len(segments)),
                 "name":name,"highway":highway,"limitKmh":limit,
                 "a":[float(a["lat"]),float(a["lon"])],"b":[float(b["lat"]),float(b["lon"])],
                 "inYoshkarOla":inside(lon,lat,city)}
            key=(round(row["a"][0],6),round(row["a"][1],6),round(row["b"][0],6),round(row["b"][1],6),limit)
            if key in seen:continue
            seen.add(key);segments.append(row)
            if row["inYoshkarOla"]:city_count+=1
    if len(segments)<20:raise RuntimeError("OSM maxspeed import unexpectedly small: "+str(len(segments)))
    data={"schemaVersion":1,"source":"OpenStreetMap way[maxspeed] (ODbL)","updatedAt":datetime.now(timezone.utc).isoformat(),
          "region":"Республика Марий Эл","segments":segments,"counts":{"mari-el":len(segments),"yoshkar-ola":city_count}}
    with open(OUT,"w",encoding="utf-8") as f:json.dump(data,f,ensure_ascii=False,separators=(",",":"))
    print("Imported",len(segments),"OSM maxspeed segments; Yoshkar-Ola:",city_count)

if __name__=="__main__":main()
