# BMW Speed Camera Warning 0.7.0

Standalone BMW MGU ID7 app. Independent of Weather; Weather 0.2.7 is not used.

## Database sections

- **Republic of Mari El** — regional dataset clipped to the Nominatim administrative boundary. Main import: SpeedCams.world Russia CSV; additional current OSM camera nodes from Overpass.
- **Yoshkar-Ola** — a separate city section containing SpeedCams.world points inside the city boundary, OSM camera nodes, the curated local points, and third-party address candidates from HelpRadar (which cites SpeedCamOnline and OSM).
- Moscow and Sochi remain empty placeholders.

The city list is not a subset-only view: Yoshkar-Ola receives its own source merge. Records retain source labels, OSM IDs and source links. Co-located records are deduplicated.

### Important coordinate rule

HelpRadar / SpeedCamOnline address-only rows are shown in the Yoshkar-Ola list but have null coordinates until the camera location is confirmed. They do not appear as map pins and cannot trigger GPS alerts. The same applies to the two newly reported 2026 intersections until exact device coordinates are verified. Do not geocode a street address and treat the building coordinate as the camera location.

## Updating and offline operation

The GitHub build imports SpeedCams.world CSV, current OSM camera nodes and HelpRadar city listings, then stores the merged JSON in the repository. A separate build step imports nearby OSM highway geometry around geocoded cameras into `road-zones.json`; only road geometry is used, never OSM `maxspeed` values. The app checks the versioned JSON at startup, every six hours and manually. The database is cached locally; failed downloads keep the last good cache. Warnings use the local database without internet.

SpeedCams.world data is derived from OpenStreetMap. OSM source snapshot may lag current edits; live Overpass additions are merged during build. HelpRadar states that its list draws on SpeedCamOnline, OSM and visitor reports.

## Map and alerts

- Offline vector/schematic map, GPS marker, camera markers and source label.
- Yoshkar-Ola road drawing is a simplified scheme from published route coordinate ranges, not a full OSM street map or navigation.
- First road-matched camera warning: 500 m; at speed strictly above 90 km/h: 700 m; repeat warning: 200 m along the matched road.
- Additional speeding alert: triggers near a camera only when GPS speed is at least 18 km/h above that camera's own recorded numeric `limit` (for example, limit 60 → alert at 78 km/h). Camera warnings are emitted only for cameras ahead of the vehicle in its current GPS course: minimum 8 km/h for a reliable course, within 35° of heading and within a 35 m lateral corridor (up to 15 m extra allowance for GPS accuracy). Cameras behind or well off the current direction are ignored. OSM road-segment speed limits are not imported or used; if a camera has no recorded limit, only the camera-presence warning is shown.
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


### Road matching (0.7.0)

Road zones are generated at build time from OpenStreetMap highway geometry around each geocoded camera. Runtime matching uses the closest road projection, a strict lateral corridor, ambiguity rejection, one-way direction, vehicle heading, and along-road distance. Two fresh GPS fixes must confirm approach before the first alert. If no camera-specific road geometry exists, the app deliberately stays silent rather than falling back to all cameras in a radius. GPS accuracy worse than 15 m also suppresses road-confirmed warnings. This is conservative by design and may reduce coverage until the OSM road importer has a valid road match for a camera. The road importer does not read or use OSM speed limits.
