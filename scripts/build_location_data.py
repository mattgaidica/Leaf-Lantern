#!/usr/bin/env python3
"""Build the static datasets used by the strategic location map.

The script intentionally keeps network acquisition and scoring reproducible. It
does not run in the browser or during the Astro build: generated GeoJSON is
reviewed and committed so GitHub Pages never needs API keys or a server.

Requirements:
  python -m pip install -r scripts/requirements-location-map.txt

Travel times use a calibrated road-time approximation (great-circle distance ×
regional circuity factor, with an effective speed that rises with trip length
to reflect highway share). This is appropriate for ~2.4 km screening cells and
is labeled as an approximation everywhere it surfaces. Swapping in a true road
router (e.g. OSRM/Valhalla) later only requires replacing travel_minutes().
"""

from __future__ import annotations

import json
import math
import time
import zipfile
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
import requests
from shapely import set_precision
from shapely.geometry import Polygon, box


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "geodata"
OUTPUT = ROOT / "public" / "data"
COMPETITORS_PATH = ROOT / "src" / "data" / "location-competitors.json"

# Broad enough to test the stated corridor rather than treating it as truth.
STUDY_BBOX = (-84.30, 41.70, -82.65, 43.05)
DISPLAY_BBOX = (-84.18, 41.80, -82.78, 42.88)
MICHIGAN_FIPS = "26"
COUNTY_FIPS = {
    "049": "Genesee",
    "065": "Ingham",
    "075": "Jackson",
    "091": "Lenawee",
    "093": "Livingston",
    "099": "Macomb",
    "115": "Monroe",
    "125": "Oakland",
    "155": "Shiawassee",
    "161": "Washtenaw",
    "163": "Wayne",
}
ACS_YEAR = 2024
ACS_VARIABLES = {
    "population": "B01003_001E",
    "households": "B11001_001E",
    "households_children": "B11005_002E",
    "median_income": "B19013_001E",
    "under_18_m": ["B01001_003E", "B01001_004E", "B01001_005E", "B01001_006E"],
    "under_18_f": ["B01001_027E", "B01001_028E", "B01001_029E", "B01001_030E"],
    "age_25_44_m": ["B01001_011E", "B01001_012E", "B01001_013E", "B01001_014E"],
    "age_25_44_f": ["B01001_035E", "B01001_036E", "B01001_037E", "B01001_038E"],
}

TIGER_URL = (
    "https://www2.census.gov/geo/tiger/GENZ2024/shp/"
    "cb_2024_26_tract_500k.zip"
)
NCES_URL = (
    "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/"
    "EDGE_GEOCODE_PUBLICSCH_2425/MapServer/0/query"
)
MUNICIPAL_URL = (
    "https://gis.semcog.org/server/rest/services/Hosted/bymcd/"
    "FeatureServer/0/query"
)
LAND_USE_URL = (
    "https://gis.semcog.org/server/rest/services/hosted/Land_Use_2020/"
    "FeatureServer/7/query"
)
WETLANDS_URL = (
    "https://gis.semcog.org/server/rest/services/Hosted/Wetlands/"
    "FeatureServer/0/query"
)
FEMA_URL = (
    "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/"
    "MapServer/28/query"
)
DNR_PARKS_URL = (
    "https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/"
    "DNRManagementBoundariesOPENDATA/FeatureServer/8/query"
)
AADT_BASE = (
    "https://mdotgis.state.mi.us/arcgis/rest/services/DataAccess/"
    "MdotAadtCaadt/MapServer"
)

HTTP = requests.Session()
HTTP.headers.update({"User-Agent": "Leaf-and-Lantern-site-selection/1.0"})
BASINS = [
    {"name": "Northville", "longitude": -83.4833, "latitude": 42.4311},
    {"name": "Plymouth", "longitude": -83.4695, "latitude": 42.3714},
    {"name": "Novi", "longitude": -83.4755, "latitude": 42.4806},
    {"name": "Farmington Hills", "longitude": -83.3772, "latitude": 42.4989},
    {"name": "Livonia", "longitude": -83.3527, "latitude": 42.3684},
    {"name": "South Lyon", "longitude": -83.6516, "latitude": 42.4606},
    {"name": "Western Canton", "longitude": -83.5263, "latitude": 42.3086},
    {"name": "Ann Arbor", "longitude": -83.7430, "latitude": 42.2808},
    {"name": "Dexter", "longitude": -83.8886, "latitude": 42.3384},
    {"name": "Western metro Detroit", "longitude": -83.2863, "latitude": 42.3970},
]


def ensure_dirs() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)


def download(url: str, destination: Path) -> Path:
    if destination.exists():
        return destination
    print(f"Downloading {url}")
    with HTTP.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as handle:
            for chunk in response.iter_content(1024 * 1024):
                handle.write(chunk)
    return destination


def arcgis_geojson(
    url: str,
    *,
    out_fields: str = "*",
    where: str = "1=1",
    bbox: tuple[float, float, float, float] = STUDY_BBOX,
    page_size: int = 2000,
    cache_name: str,
) -> dict[str, Any]:
    cache_path = CACHE / cache_name
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    features: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = {
            "where": where,
            "outFields": out_fields,
            "geometry": ",".join(str(value) for value in bbox),
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "outSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "returnGeometry": "true",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "f": "geojson",
        }
        response = HTTP.get(url, params=params, timeout=180)
        response.raise_for_status()
        payload = response.json()
        if "error" in payload:
            raise RuntimeError(f"ArcGIS error from {url}: {payload['error']}")
        batch = payload.get("features", [])
        features.extend(batch)
        print(f"{cache_name}: {len(features)} features")
        if len(batch) < page_size:
            break
        offset += len(batch)
        time.sleep(0.1)

    result = {"type": "FeatureCollection", "features": features}
    cache_path.write_text(json.dumps(result))
    return result


def fetch_acs() -> pd.DataFrame:
    cache_path = CACHE / f"acs-{ACS_YEAR}.json"
    all_variables = [
        ACS_VARIABLES["population"],
        ACS_VARIABLES["households"],
        ACS_VARIABLES["households_children"],
        ACS_VARIABLES["median_income"],
        *ACS_VARIABLES["under_18_m"],
        *ACS_VARIABLES["under_18_f"],
        *ACS_VARIABLES["age_25_44_m"],
        *ACS_VARIABLES["age_25_44_f"],
    ]
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
        rows = cached["rows"]
    else:
        rows = []
        table_ids = sorted(
            {
                variable.split("_")[0]
                for variable in all_variables
            }
        )
        for county in COUNTY_FIPS:
            response = HTTP.get(
                "https://api.censusreporter.org/1.0/data/show/latest",
                params={
                    "table_ids": ",".join(table_ids),
                    "geo_ids": f"140|05000US{MICHIGAN_FIPS}{county}",
                },
                timeout=120,
            )
            response.raise_for_status()
            payload = response.json()
            for geoid, tables in payload["data"].items():
                row = {
                    "state": geoid[7:9],
                    "county": geoid[9:12],
                    "tract": geoid[12:],
                    "tract_name": payload["geography"][geoid]["name"],
                }
                for variable in all_variables:
                    table = variable.split("_")[0]
                    reporter_variable = variable.replace("_", "").removesuffix("E")
                    row[variable] = tables[table]["estimate"].get(reporter_variable)
                rows.append(row)
            release = payload.get("release", {}).get("name", f"{ACS_YEAR} ACS 5-year")
            print(f"ACS {county}: {len(payload['data'])} tracts ({release})")
        cache_path.write_text(json.dumps({"release": release, "rows": rows}, indent=2))

    frame = pd.DataFrame(rows)
    numeric = [column for column in frame if column.endswith("E")]
    frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
    frame["GEOID"] = frame["state"] + frame["county"] + frame["tract"]
    frame["under_18"] = frame[
        ACS_VARIABLES["under_18_m"] + ACS_VARIABLES["under_18_f"]
    ].sum(axis=1)
    frame["age_25_44"] = frame[
        ACS_VARIABLES["age_25_44_m"] + ACS_VARIABLES["age_25_44_f"]
    ].sum(axis=1)
    return frame.rename(
        columns={
            ACS_VARIABLES["population"]: "population",
            ACS_VARIABLES["households"]: "households",
            ACS_VARIABLES["households_children"]: "households_children",
            ACS_VARIABLES["median_income"]: "median_income",
        }
    )


def tract_data() -> gpd.GeoDataFrame:
    archive = download(TIGER_URL, CACHE / "cb_2024_26_tract_500k.zip")
    extract_dir = CACHE / "tracts"
    if not extract_dir.exists():
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(extract_dir)
    shapefile = next(extract_dir.glob("*.shp"))
    tracts = gpd.read_file(shapefile).to_crs(4326)
    tracts = tracts[tracts["COUNTYFP"].isin(COUNTY_FIPS)].copy()
    tracts = tracts.clip(box(*STUDY_BBOX))
    tracts = tracts.merge(fetch_acs(), on="GEOID", how="left")
    projected = tracts.to_crs(3078)
    tracts["area_sq_mi"] = projected.area / 2_589_988.110336
    tracts["population_density"] = tracts["population"] / tracts["area_sq_mi"]
    tracts["children_household_share"] = (
        tracts["households_children"] / tracts["households"].replace(0, pd.NA)
    )
    tracts["under_18_share"] = (
        tracts["under_18"] / tracts["population"].replace(0, pd.NA)
    )
    tracts["age_25_44_share"] = (
        tracts["age_25_44"] / tracts["population"].replace(0, pd.NA)
    )
    return tracts


def quantile_score(series: pd.Series, *, invert: bool = False) -> pd.Series:
    valid = series.replace([math.inf, -math.inf], pd.NA).dropna()
    if valid.empty:
        return pd.Series(50.0, index=series.index)
    ranks = series.rank(pct=True, method="average").fillna(0.5) * 100
    return 100 - ranks if invert else ranks


def family_index(tracts: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    tracts = tracts.copy()
    tracts["family_index"] = (
        quantile_score(tracts["households_children"]) * 0.35
        + quantile_score(tracts["children_household_share"]) * 0.25
        + quantile_score(tracts["under_18"]) * 0.20
        + quantile_score(tracts["age_25_44"]) * 0.20
    )
    tracts["affluence_score"] = quantile_score(tracts["median_income"])
    return tracts


def h3_polygon(cell: str) -> Polygon:
    # h3 returns lat/lng; GeoJSON and shapely expect lng/lat.
    return Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(cell)])


def candidate_grid() -> gpd.GeoDataFrame:
    boundary = {
        "type": "Polygon",
        "coordinates": [[
            [STUDY_BBOX[0], STUDY_BBOX[1]],
            [STUDY_BBOX[2], STUDY_BBOX[1]],
            [STUDY_BBOX[2], STUDY_BBOX[3]],
            [STUDY_BBOX[0], STUDY_BBOX[3]],
            [STUDY_BBOX[0], STUDY_BBOX[1]],
        ]],
    }
    cells = sorted(h3.geo_to_cells(boundary, 7))
    frame = gpd.GeoDataFrame(
        {"cell_id": cells, "geometry": [h3_polygon(cell) for cell in cells]},
        crs=4326,
    )
    centers = [h3.cell_to_latlng(cell) for cell in cells]
    frame["latitude"] = [center[0] for center in centers]
    frame["longitude"] = [center[1] for center in centers]
    return frame


CIRCUITY = 1.25  # typical road/straight-line ratio for SE Michigan's grid


def travel_minutes(
    origin_lat: np.ndarray,
    origin_lng: np.ndarray,
    dest_lat: np.ndarray,
    dest_lng: np.ndarray,
) -> np.ndarray:
    """Approximate door-to-door drive time in minutes (origins × destinations).

    Road distance = great-circle × circuity. Effective speed rises with trip
    length (short trips are local roads; long trips use highways), plus a
    fixed 3-minute access/egress overhead.
    """
    lat1 = np.radians(origin_lat)[:, None]
    lat2 = np.radians(dest_lat)[None, :]
    dlat = lat2 - lat1
    dlng = np.radians(dest_lng)[None, :] - np.radians(origin_lng)[:, None]
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlng / 2) ** 2
    km = 6371.0 * 2 * np.arcsin(np.sqrt(a)) * CIRCUITY
    speed_kmh = 38 + 34 * (1 - np.exp(-km / 18))
    return 3 + 60 * km / speed_kmh


def road_time_scores(
    grid: gpd.GeoDataFrame,
    tracts: gpd.GeoDataFrame,
    competitors: list[dict[str, Any]],
) -> gpd.GeoDataFrame:
    grid_lat = grid["latitude"].to_numpy()
    grid_lng = grid["longitude"].to_numpy()

    tract_points = tracts.to_crs(3078).representative_point().to_crs(4326)
    tract_minutes = travel_minutes(
        grid_lat, grid_lng, tract_points.y.to_numpy(), tract_points.x.to_numpy()
    )
    households = tracts["households"].fillna(0).to_numpy(dtype=float)
    family_weight = households * tracts["family_index"].fillna(0).to_numpy(dtype=float) / 100

    band_15 = tract_minutes <= 15
    band_30 = (tract_minutes > 15) & (tract_minutes <= 30)
    band_45 = (tract_minutes > 30) & (tract_minutes <= 45)
    for band, mask in (("15", band_15), ("30", band_30), ("45", band_45)):
        grid[f"households_{band}"] = (mask * households).sum(axis=1).round()
        grid[f"family_demand_{band}"] = (mask * family_weight).sum(axis=1).round()

    # Urban embeddedness separates a true rural edge from a low-density hole
    # (industrial land, parks) surrounded by dense city fabric. The window is
    # kept tight (~8 minutes, dense tracts >3,000/sq mi) so that being a short
    # drive from suburban density — the desired rural-edge pattern — is not
    # itself penalized; only immediate urban surroundings are.
    dense_tract = tracts["population_density"].fillna(0).to_numpy() > 3000
    urban_households = ((tract_minutes <= 8) * households * dense_tract).sum(axis=1)
    # Absolute scale: 0 = no dense fabric nearby, ~96 = deep in the metro core.
    grid["urban_embeddedness"] = (100 * (1 - np.exp(-urban_households / 30000))).round(1)

    competitor_minutes = travel_minutes(
        grid_lat,
        grid_lng,
        np.array([item["latitude"] for item in competitors]),
        np.array([item["longitude"] for item in competitors]),
    )
    basin_minutes = travel_minutes(
        grid_lat,
        grid_lng,
        np.array([item["latitude"] for item in BASINS]),
        np.array([item["longitude"] for item in BASINS]),
    )

    # Competition is a travel-time pressure field. Scores 2–3 remain visible
    # but cannot dominate the site score.
    direct = np.array([item["direct_competition_score"] for item in competitors])
    effect = np.zeros_like(competitor_minutes)
    effect[:, direct == 5] = np.maximum(0, 1 - competitor_minutes[:, direct == 5] / 32) ** 1.35
    effect[:, direct == 4] = np.maximum(0, 1 - competitor_minutes[:, direct == 4] / 26) ** 1.5
    effect[:, direct == 3] = 0.35 * np.maximum(0, 1 - competitor_minutes[:, direct == 3] / 22)
    effect[:, direct <= 2] = 0.15 * np.maximum(0, 1 - competitor_minutes[:, direct <= 2] / 18)
    weighted = effect * (direct / 5)[None, :]
    grid["competitor_pressure_raw"] = weighted.sum(axis=1).round(4)

    grid["competitor_travel_times"] = [
        [
            {
                "name": competitors[j]["name"],
                "score": int(direct[j]),
                "minutes": round(float(competitor_minutes[i, j]), 1),
            }
            for j in range(len(competitors))
            if competitor_minutes[i, j] <= 55
        ]
        for i in range(len(grid))
    ]
    grid["basin_travel_times"] = [
        [
            {"name": BASINS[j]["name"], "minutes": round(float(basin_minutes[i, j]), 1)}
            for j in range(len(BASINS))
        ]
        for i in range(len(grid))
    ]
    grid["nearest_competitors"] = [
        sorted(
            (
                {
                    "name": competitors[j]["name"],
                    "minutes": round(float(competitor_minutes[i, j])),
                    "effect": round(float(weighted[i, j]), 3),
                }
                for j in range(len(competitors))
                if weighted[i, j] > 0.08
            ),
            key=lambda item: item["effect"],
            reverse=True,
        )[:3]
        for i in range(len(grid))
    ]
    return grid


def spatial_context(
    grid: gpd.GeoDataFrame,
    tracts: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    grid = grid.copy()
    centers = gpd.GeoDataFrame(
        grid[["cell_id"]],
        geometry=gpd.points_from_xy(grid.longitude, grid.latitude),
        crs=4326,
    )
    joined = gpd.sjoin(
        centers,
        tracts[
            [
                "GEOID",
                "population_density",
                "family_index",
                "affluence_score",
                "median_income",
                "geometry",
            ]
        ],
        how="left",
        predicate="within",
    ).set_index("cell_id")
    for column in [
        "GEOID",
        "population_density",
        "family_index",
        "affluence_score",
        "median_income",
    ]:
        grid[column] = grid["cell_id"].map(joined[column])

    # Cells whose center falls outside every US tract are open water or
    # across the border; scoring them would fabricate "whitespace".
    grid = grid[grid["GEOID"].notna()].reset_index(drop=True)
    centers = centers[centers["cell_id"].isin(grid["cell_id"])].reset_index(drop=True)

    # The desired edge pattern is locally low/moderate density with strong
    # reachable demand. An absolute scale (not a within-region percentile)
    # keeps "rural" meaning rural even in a study area full of farmland:
    # ~200/sq mi scores ~87, ~1,000 scores ~51, ~3,000+ approaches zero.
    density = grid["population_density"].fillna(0)
    grid["low_density_score"] = (100 * np.exp(-density / 1500)).round(1)

    schools_path = CACHE / "schools.geojson"
    if schools_path.exists():
        schools = gpd.read_file(schools_path).to_crs(3078)
        grid_points = centers.to_crs(3078)
        nearby = gpd.sjoin(
            grid_points,
            schools[["geometry"]],
            how="left",
            predicate="dwithin",
            distance=24_000,
        )
        counts = nearby.groupby("cell_id")["index_right"].count()
        grid["nearby_school_count"] = grid["cell_id"].map(counts).fillna(0)
        school_volume = quantile_score(grid["nearby_school_count"])
        local_family = grid["family_index"].fillna(50)
        grid["school_score"] = school_volume * 0.55 + local_family * 0.45
    else:
        grid["nearby_school_count"] = 0
        grid["school_score"] = 50.0
    return grid


def export_geojson(frame: gpd.GeoDataFrame, path: Path, columns: Iterable[str]) -> None:
    selected = frame[[*columns, "geometry"]].copy()
    # ~11 m coordinate precision keeps screening files small on GitHub Pages.
    selected["geometry"] = set_precision(selected.geometry.to_numpy(), 0.0001)
    for column in selected.columns:
        if selected[column].dtype == float:
            selected[column] = selected[column].round(1)
    payload = json.loads(selected.to_json(drop_id=True, to_wgs84=True))
    path.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB)")


def normalize_scores(grid: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    grid = grid.copy()
    incremental_15 = grid["family_demand_15"]
    incremental_30 = grid["family_demand_30"]
    incremental_45 = grid["family_demand_45"]
    grid["drive_demand_raw"] = (
        incremental_15
        + incremental_30 * 0.70
        + incremental_45 * 0.35
    )
    grid["drive_demand_score"] = quantile_score(grid["drive_demand_raw"])
    grid["competitive_whitespace_score"] = quantile_score(
        grid["competitor_pressure_raw"], invert=True
    )
    # Open context requires BOTH locally low density and freedom from dense
    # urban surroundings (multiplicative), so a low-density industrial hole
    # inside the metro cannot pose as rural edge.
    grid["open_context_score"] = (
        grid["low_density_score"] * (100 - grid["urban_embeddedness"]) / 100
    )
    # Destination score rewards a rural setting only when substantial family
    # demand is reachable; remote low-density cells do not receive a free pass.
    grid["destination_character_score"] = (
        grid["open_context_score"] * 0.55
        + grid["drive_demand_score"] * 0.45
    )
    # Multiple reachable population basins are the core access signal. AADT is
    # displayed separately because pass-by volume and congestion are not access.
    def basin_access(items: list[dict[str, Any]]) -> float:
        minutes = [item["minutes"] for item in items if item.get("minutes") is not None]
        if not minutes:
            return 0
        within_30 = sum(value <= 30 for value in minutes)
        within_45 = sum(value <= 45 for value in minutes)
        nearest = min(minutes)
        return min(100, within_30 * 10 + within_45 * 4 + max(0, 30 - nearest))

    grid["road_access_score"] = grid["basin_travel_times"].apply(basin_access)
    grid["development_score"] = 50.0  # neutral where reliable overlays are absent
    grid["opportunity_score"] = (
        grid["drive_demand_score"] * 0.30
        + grid["competitive_whitespace_score"] * 0.20
        + grid["destination_character_score"] * 0.15
        + grid["affluence_score"].fillna(50) * 0.15
        + grid["road_access_score"] * 0.10
        + grid["school_score"] * 0.05
        + grid["development_score"] * 0.05
    )
    return grid


def load_competitors() -> list[dict[str, Any]]:
    if not COMPETITORS_PATH.exists():
        raise FileNotFoundError(
            f"Create the researched competitor dataset at {COMPETITORS_PATH}"
        )
    return json.loads(COMPETITORS_PATH.read_text())


def export_reference_layers() -> None:
    layers = [
        ("schools.geojson", NCES_URL, "STATE='MI'", "*"),
        ("municipalities.geojson", MUNICIPAL_URL, "1=1", "*"),
    ]
    for filename, endpoint, where, fields in layers:
        try:
            payload = arcgis_geojson(
                endpoint,
                where=where,
                out_fields=fields,
                cache_name=filename,
            )
            (OUTPUT / filename).write_text(json.dumps(payload, separators=(",", ":")))
        except Exception as error:
            # A failed optional service must not silently create a false layer.
            print(f"WARNING: skipped {filename}: {error}")

def write_metadata(grid: gpd.GeoDataFrame, tracts: gpd.GeoDataFrame) -> None:
    metadata = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "study_bbox": STUDY_BBOX,
        "display_bbox": DISPLAY_BBOX,
        "acs_vintage": f"{ACS_YEAR} ACS 5-year",
        "tract_count": len(tracts),
        "grid_count": len(grid),
        "grid_system": "H3 resolution 7 (~5.2 km² cells)",
        "growth_note": (
            "Household growth is not scored. Comparable tract-level annual ACS "
            "estimates overlap heavily, and boundary changes can create false growth."
        ),
        "default_weights": {
            "drive_demand": 30,
            "competitive_whitespace": 20,
            "destination_character": 15,
            "affluence": 15,
            "road_access": 10,
            "schools": 5,
            "development": 5,
        },
        "drive_time_weights": {"0_15": 1.0, "15_30": 0.7, "30_45": 0.35},
        "travel_time_model": (
            "Approximation: great-circle distance × 1.25 circuity, effective speed "
            "38–72 km/h rising with trip length, +3 min access overhead. Not a road "
            "router; adequate for regional screening, not for site-level claims."
        ),
        "limitations": [
            "Travel times are calibrated approximations, not routed drives; verify specific drives before shortlisting.",
            "Tract totals are assigned by representative point for drive-time aggregation.",
            "Scores compare cells inside this study area; they are not absolute feasibility ratings.",
            "Environmental overlays are screening indicators, never parcel due diligence.",
            "Generalized GIS cannot establish zoning, utility capacity, access permits, or buildability.",
        ],
    }
    (OUTPUT / "location-metadata.json").write_text(json.dumps(metadata, indent=2))


def main() -> None:
    ensure_dirs()
    competitors = load_competitors()
    tracts = family_index(tract_data())
    grid = spatial_context(candidate_grid(), tracts)
    grid = road_time_scores(grid, tracts, competitors)
    grid = normalize_scores(grid)

    export_geojson(
        tracts,
        OUTPUT / "demographics.geojson",
        [
            "GEOID",
            "tract_name",
            "population",
            "households",
            "households_children",
            "median_income",
            "under_18",
            "age_25_44",
            "population_density",
            "family_index",
            "affluence_score",
        ],
    )
    export_geojson(
        grid,
        OUTPUT / "opportunity-grid.geojson",
        [
            "cell_id",
            "latitude",
            "longitude",
            "households_15",
            "households_30",
            "households_45",
            "family_demand_15",
            "family_demand_30",
            "family_demand_45",
            "drive_demand_raw",
            "drive_demand_score",
            "competitive_whitespace_score",
            "competitor_pressure_raw",
            "nearest_competitors",
            "competitor_travel_times",
            "basin_travel_times",
            "destination_character_score",
            "open_context_score",
            "low_density_score",
            "urban_embeddedness",
            "affluence_score",
            "median_income",
            "road_access_score",
            "school_score",
            "development_score",
            "opportunity_score",
        ],
    )
    (OUTPUT / "competitors.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [item["longitude"], item["latitude"]],
                        },
                        "properties": item,
                    }
                    for item in competitors
                ],
            },
            separators=(",", ":"),
        )
    )
    export_reference_layers()
    write_metadata(grid, tracts)


if __name__ == "__main__":
    main()
