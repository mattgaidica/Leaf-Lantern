# Leaf & Lantern strategic location model

This document is the audit trail for the standalone `/location-strategy/` screening map. The model
compares geographic cells across a broad southeast Michigan study area. It is deliberately not a
parcel-ranking, zoning, appraisal, or engineering tool.

## Study design

- **Extent:** approximately 41.70–43.05° N and 84.30–82.65° W. This includes the stated western
  metro/Ann Arbor hypothesis plus meaningful alternatives to its north, south, east, and west.
- **Candidate unit:** H3 resolution 7 cells (about 5.2 km² each). The unit is small enough to expose
  corridor and rural-edge differences without implying parcel precision.
- **Display unit:** every score is normalized from 0–100 against cells inside this study area.
  A score of 80 means “stronger than most cells considered,” not an 80% chance of success.
- **Data build:** `scripts/build_location_data.py` creates reviewed static GeoJSON. Browser clients
  never call Census, routing, or government services and require no secret keys.

## Components

### Drive-time family demand — default weight 30%

Travel times use a calibrated approximation rather than a road router: great-circle distance × 1.25
(the typical road/straight-line circuity for southeast Michigan's road grid), an effective speed
that rises from ~38 km/h for short local trips toward ~72 km/h for longer highway-share trips, plus
a 3-minute access/egress overhead. Spot checks against known corridor drives (e.g. Northville–Ann
Arbor ≈ 34 modeled vs ~30–35 actual minutes) support screening-level use. Every surface that shows
a travel time labels it as modeled. Swapping in a true road router (OSRM/Valhalla) later only
requires replacing one function (`travel_minutes`) in the pipeline.

For each candidate cell, the model estimates travel time to each tract's representative point and
aggregates the tract's Family Demand Index.

Default incremental bands:

`0–15 minutes × 1.00 + 15–30 minutes × 0.70 + 30–45 minutes × 0.35`

The Family Demand Index combines tract percentile ranks:

- households with children under 18: 35%
- share of households with children: 25%
- population under 18: 20%
- population age 25–44: 20%

Tract totals are assigned by representative point, not spatially disaggregated. That limitation
matters most where a large rural tract straddles a travel-time boundary.

### Competitive whitespace — default weight 20%

Each competitor is researched as a distinct operating concept and assigned direct-overlap score
1–5. Pressure is calculated from actual road time from a candidate cell:

- score 5: strong nonlinear effect through 32 minutes by default
- score 4: meaningful nonlinear effect through 26 minutes
- score 3: informational effect through 22 minutes
- score 1–2: light context through 18 minutes

The score-5 and score-4 reaches are adjustable in the map. A small orchard therefore cannot produce
the same exclusion effect as a full destination cider mill. This remains a screening proxy:
marketing strength, road direction, customer loyalty, and operating calendars are not fully observed.

### Destination character — default weight 15%

Destination character combines an **open-context score** with reachable demand:

`55% open context + 45% drive-time demand`

Open context itself is multiplicative: an absolute low-density score (≈87 at 200 people/sq mi,
≈51 at 1,000, near zero above 3,000) × freedom from urban embeddedness (households in dense
tracts reachable within ~8 minutes). The multiplication matters — a low-density industrial hole
inside the metro fails the embeddedness test, and a dense downtown fails the density test, while
rural Salem Township passes both. Cells whose centers fall outside any US census tract (open
water, the Ontario side of the study rectangle) are excluded entirely.

The map does not infer mature trees, frontage, scenic quality, or congestion from regional
polygons. Those require field review and parcel-level imagery.

### Affluence — default weight 15%

Tract median household income from the 2024 ACS five-year estimate is percentile-ranked inside the
study area. It remains independent from the Family Demand Index so the user can see whether a cell
benefits from family volume, spending capacity, or both.

### Road accessibility — default weight 10%

The model uses 2025 MDOT AADT layers for trunkline, non-trunkline federal-aid, and available local
roads. Moderate nearby traffic supports access and visibility; extremely high-volume context is not
automatically rewarded because congestion and destination character are separate concerns. AADT does
not establish driveway access, turn movements, road jurisdiction, or seasonal congestion.

### Schools — default weight 5%

NCES EDGE 2024–25 public-school locations provide the secondary education-demand signal, combined
with tract school-age population. School points do not by themselves establish enrollment, district
interest, bus policy, or field-trip demand.

### Development favorability — default weight 5%

Screening overlays include SEMCOG wetlands, FEMA Special Flood Hazard Areas, and Michigan DNR park
boundaries. Cells with mapped constraints are penalized at regional resolution. Missing sewer/water
service boundaries are treated as unknown—not favorable. Generalized environmental data cannot
determine wetland boundaries, flood elevations, protected status, buildable area, or permitting.

## Demographic fields

Source: [2024 ACS five-year detailed tables](https://api.census.gov/data/2024/acs/acs5.html).

- population: `B01003_001E`
- households: `B11001_001E`
- households with children under 18: `B11005_002E`
- median household income: `B19013_001E`
- under 18: `B01001_003E`–`006E` + `B01001_027E`–`030E`
- age 25–44: `B01001_011E`–`014E` + `B01001_035E`–`038E`

Household growth is intentionally not scored. Adjacent ACS five-year releases share most observations,
while older releases can use different tract boundaries. Presenting that difference as local growth
would be more precise-looking than defensible.

## Other primary sources

- [Census 2024 cartographic tract boundaries](https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html)
- [NCES EDGE public school locations](https://nces.ed.gov/programs/edge/Geographic/SchoolLocations)
- [MDOT AADT/CAADT map service](https://mdotgis.state.mi.us/arcgis/rest/services/DataAccess/MdotAadtCaadt/MapServer)
- [SEMCOG open data](https://maps-semcog.opendata.arcgis.com/)
- [FEMA National Flood Hazard Layer](https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm)
- [Michigan DNR open data](https://gis-michigan.opendata.arcgis.com/)

All source URLs and research dates for competitors are retained in
`src/data/location-competitors.json`.

## Required next stage

Use the model to identify approximately 3–6 search zones. Only then should the team add parcels and
repeat the analysis with:

- parcel boundaries, ownership, asking/off-market status, and assessed values
- confirmed zoning and special/conditional-use path
- wetland delineation, flood elevation, soils, drainage, and protected-land review
- utility availability and capacity confirmed with the serving authority
- driveway/curb-cut feasibility, frontage, sight distance, and turning analysis
- peak seasonal route testing, site visits, viewsheds, and adjacent-use review

