# BMW Speed Camera Warning 0.5.7

Standalone BMW MGU ID7 app. Independent of Weather; Weather 0.2.7 is not used.

## Database sections

- **Republic of Mari El** — regional dataset clipped to the Nominatim administrative boundary. Main import: SpeedCams.world Russia CSV; additional current OSM camera nodes from Overpass.
- **Yoshkar-Ola** — a separate city section containing SpeedCams.world points inside the city boundary, OSM camera nodes, the curated local points, and third-party address candidates from HelpRadar (which cites SpeedCamOnline and OSM).
- Moscow and Sochi remain empty placeholders.

The city list is not a subset-only view: Yoshkar-Ola receives its own source merge. Records retain source labels, OSM IDs and source links. Co-located records are deduplicated.

### Important coordinate rule

HelpRadar / SpeedCamOnline address-only rows are shown in the Yoshkar-Ola list but have null coordinates until the camera location is confirmed. They do not appear as map pins and cannot trigger GPS alerts. The same applies to the two newly reported 2026 intersections until exact device coordinates are verified. Do not geocode a street address and treat the building coordinate as the camera location.

## Updating and offline operation

The GitHub build imports SpeedCams.world CSV, current OSM camera nodes and HelpRadar city listings, then stores the merged JSON in the repository and bundles it into the MGU app. The app checks the versioned JSON at startup, every six hours and manually. The database is cached locally; failed downloads keep the last good cache. Warnings use the local database without internet.

SpeedCams.world data is derived from OpenStreetMap. OSM source snapshot may lag current edits; live Overpass additions are merged during build. HelpRadar states that its list draws on SpeedCamOnline, OSM and visitor reports.

## Map and alerts

- Offline vector/schematic map, GPS marker, camera markers and source label.
- Yoshkar-Ola road drawing is a simplified scheme from published route coordinate ranges, not a full OSM street map or navigation.
- First camera warning: 500 m; at speed strictly above 90 km/h: 700 m; repeat warning: 200 m.
- Additional speeding alert: triggers at camera approach when GPS speed is at least 18 km/h above the camera's recorded `limit` (for example, limit 60 → alert at 78 km/h). The camera-presence warning remains active regardless of speed.
- Speeding alerts are only evaluated where the camera record contains a numeric speed limit. If a camera has no recorded limit, the app does not guess one and will show only the camera-presence warning. This version uses the limit attached to the camera record; it does not yet infer a road-wide speed limit from nearby OSM road geometry.
- GPS warnings use fresh BMW GPS coordinates. If GST is unavailable, HDOP is used as a conservative accuracy estimate; missing RMC speed is treated as 0 km/h. Fixes with reported accuracy worse than 75 m are ignored.
- When Yoshkar-Ola is selected, proximity monitoring also includes the regional Mari El camera list, so cameras outside the city boundary are not silently excluded.
- A detected camera triggers a prominent on-screen warning banner and a log event for 10 seconds. Audio output is not enabled in this release.
- Unlocated entries are excluded from proximity calculations.
- Voice output remains disabled; the app does not manipulate radio/system volume.

## Attribution and licences

Camera data from OpenStreetMap contributors is available under ODbL 1.0. SpeedCams.world republishes OSM-derived data. Keep the attribution and licence with redistributed database extracts: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright. HelpRadar / SpeedCamOnline is an additional discovery source; its unlocated address rows are not converted into coordinate data.

## Sources

- SpeedCams.world Russia download: https://speedcams.world/download/russia
- OpenStreetMap: https://www.openstreetmap.org/
- Overpass API: https://overpass-api.de/
- HelpRadar Yoshkar-Ola: https://helpradar.ru/kamery-gibdd/ioshkar-ola
- SpeedCamOnline Russia: https://speedcamonline.ru/map/Rus/1562/
- Curated Yoshkar-Ola coordinates: https://www.driver-helper.ru/kamery-gibdd/joshkar_ola
- 2026 new intersection installations: https://www.marpravda.ru/news/auto/v-yoshkar-ole-na-perekrestkakh-za-voditelyami-sledyat-2-novye-skorostnye-kamery/
