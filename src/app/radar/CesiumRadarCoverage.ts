import * as Cesium from "cesium";

// =============================================================================
// Types
// =============================================================================

export interface RadarOptions {
    entityId: string;
    longitude: number;
    latitude: number;
    altitude?: number;
    beam: BeamSettings;
    azimuthStepDeg?: number;
    // Distance (m) between terrain samples along each ray.
    sampleSpacingM?: number;
    style: RadarStyle;
}

// The one beam the radar sends out: a single sheet at one elevation angle,
// spread over the beam width (360 = every direction round the radar).
export interface BeamSettings {
    // Centre of the beam, degrees clockwise from north.
    azimuthDeg: number;
    // Horizontal width of the beam (360 = all round).
    widthDeg: number;
    range: number;
    // Elevation angle of the beam (0 = level with the antenna).
    elevationDeg: number;
    // Height above the terrain of the aircraft the LOS probe works out for.
    targetHeightAgl: number;
    // Antenna height above the ground it stands on.
    mastHeight: number;
}

// Settings that only change how the coverage looks. Applied in place through
// RadarCoverageHandle.setStyle, without re-sampling terrain or rebuilding.
export interface RadarStyle {
    // "Only this angle" mode: showReach shows the part of the beam that clears
    // the terrain (green), showBlocked the part stopped by it (red).
    // "0° up to this angle" mode: showReach shows the air and ground the
    // radar sees (green), showBlocked the air and ground hidden (red).
    beamOpacity: number;
    showBeam: boolean;
    showReach: boolean;
    showBlocked: boolean;
    showLabels: boolean;
    // Also show every lower angle from 0° up to the beam (a solid fan), not
    // just the sheet at the beam's own angle.
    showLowerBeams: boolean;
    // "Only this angle" mode: draw the whole beam green and mark with red
    // points where each blocked ray meets the terrain (showBlocked toggles
    // the points), instead of colouring blocked directions red.
    showStopPoints: boolean;
    // "Only this angle" mode: a thin line along every ray the terrain is
    // checked on, from the antenna to where it ends.
    showRays: boolean;
    // "0° up to this angle" mode: shade the solid figure by the light, and
    // draw it see-through (else opaque).
    volumeLit: boolean;
    volumeTransparent: boolean;
    // How strong the light shading is (0 = none, 1 = strongest), and how
    // opaque the figure is when drawn see-through (0-1).
    volumeLight: number;
    volumeOpacity: number;
    // Ground footprint: inside the wedge from 0° up to the beam's angle,
    // green where the radar sees the ground, red where terrain hides it.
    // Switched on and off per mode: showFootprint in "Only this angle",
    // showWedgeFootprint in "0° up to this angle".
    showFootprint: boolean;
    showWedgeFootprint: boolean;
    footprintOpacity: number;
}

// One stretch of directions in which terrain stops the beam.
export interface BlockedSector {
    fromDeg: number;
    toDeg: number;
    widthDeg: number;
    // Closest point where the beam meets the terrain in this sector.
    nearestHitM: number;
    // Lowest beam angle that clears the terrain across the whole sector.
    clearDeg: number;
    // Every direction of the beam is blocked (no clear gap anywhere).
    allRound: boolean;
}

// What the beam at its current angle reaches, for the panel.
export interface BeamScanResult {
    elevationDeg: number;
    startDeg: number;
    widthDeg: number;
    range: number;
    // Share of directions where the beam runs the full range (0-100).
    clearPct: number;
    // Lowest beam angle at which every direction in the beam width is clear.
    allClearDeg: number;
    sectors: BlockedSector[];
    // Lowest clear angle per direction, binned across the beam width.
    horizon: { azDeg: number; clearDeg: number }[];
}

export interface RadarCoverageHandle {
    dispose(): void;
    setStyle?(style: RadarStyle): void;
    scan?: BeamScanResult;
}

export interface ResolvedZone {
    name: string;
    color: Cesium.Color;
    range: number;
    minElevationDeg: number;
    maxElevationDeg: number;
    azimuthStartDeg: number;
    azimuthWidthDeg: number;
}

interface TerrainProfile {
    azimuthDeg: number;
    horizontalDistances: number[];
    groundHeights: number[];
    groundPoints: Cesium.Cartographic[];
}

// Terrain seen from the antenna along one direction.
interface RayTrace {
    // Elevation angle (radians) from the antenna to the ground at each sample,
    // and the highest such angle up to and including that sample (-Infinity
    // next to the antenna, which never blocks). A ray at angle a meets the
    // terrain at the first sample where peakAngle >= a.
    groundAngle: Float32Array;
    peakAngle: Float32Array;
}

// Every direction of the beam: row = direction, column = range sample.
interface RayGrid {
    zone: ResolvedZone;
    wrap: boolean;
    profiles: TerrainProfile[];
    rays: RayTrace[];
    // Azimuth of each row (degrees, unwrapped) and the spacing between rows.
    rowAz: number[];
    rowStepDeg: number;
    enuMatrix: Cesium.Matrix4;
}

// An image draped on the terrain, and the area it covers.
interface ScoreImage {
    canvas: HTMLCanvasElement;
    rectangle: Cesium.Rectangle;
}

// Ground footprint: the seen (green) and hidden (red) ground as two images.
interface FootprintImages {
    seen: ScoreImage | null;
    hidden: ScoreImage | null;
}

// Where the beam ends in each direction.
interface BeamTips {
    dist: Float64Array;
    hit: Uint8Array;
    // Lowest clear angle (degrees) per direction.
    clearDeg: Float64Array;
}

// =============================================================================
// Defaults & tuning
// =============================================================================

export const DEFAULT_TARGET_HEIGHT_AGL_M = 0;
// A radar with no mast set has its antenna right on the ground. Then every
// 2-3 m bump in the terrain data next to it tilts the horizon up by degrees
// and can throw long false shadows; a few metres of mast avoids that.
export const DEFAULT_MAST_HEIGHT_M = 0;

export const DEFAULT_BEAM: Omit<BeamSettings, "targetHeightAgl" | "mastHeight"> = {
    azimuthDeg: 0,
    widthDeg: 360,
    range: 20000,
    elevationDeg: 0
};

export const DEFAULT_RADAR_STYLE: RadarStyle = {
    beamOpacity: 0.25,
    showBeam: true,
    showReach: true,
    showBlocked: true,
    showLabels: false,
    showLowerBeams: false,
    showStopPoints: false,
    showRays: false,
    volumeLit: true,
    volumeTransparent: true,
    volumeLight: 0.65,
    volumeOpacity: 0.45,
    showFootprint: false,
    showWedgeFootprint: true,
    footprintOpacity: 0.45
};

const CLEAR_RGB = [34, 197, 94];       // #22c55e  beam runs the full range
const BLOCKED_RGB = [239, 68, 68];     // #ef4444  beam stopped by terrain
const SEEN_RGB = [34, 197, 94];        // #22c55e  footprint: ground the radar sees
const HIDDEN_RGB = [239, 68, 68];      // #ef4444  footprint: ground hidden by terrain
const ALL_CLEAR_LABEL_CSS = "#1d4ed8"; // blue: whole beam clear, nothing above it
const CLEAR_COLOR = Cesium.Color.fromBytes(CLEAR_RGB[0], CLEAR_RGB[1], CLEAR_RGB[2]);
const BLOCKED_COLOR = Cesium.Color.fromBytes(BLOCKED_RGB[0], BLOCKED_RGB[1], BLOCKED_RGB[2]);

// World terrain is ~30 m detail in most mountain areas; sampling finer than
// this costs time without adding real accuracy.
const TERRAIN_SAMPLE_SPACING_M = 20;
// Directions across the beam when no azimuth step is set: about this many, but
// never closer than MIN_AZIMUTH_STEP_DEG or further apart than MAX_AZIMUTH_STEP_DEG.
const TARGET_RAYS_ACROSS_BEAM = 240;
const MIN_AZIMUTH_STEP_DEG = 0.1;
const MAX_AZIMUTH_STEP_DEG = 1;
// Terrain profiles kept from earlier builds (most recent last).
const PROFILE_CACHE_SIZE = 8;
const EARTH_RADIUS_M = 6371000;
// Standard radar "4/3 Earth" model: the atmosphere bends the beam slightly
// downward, so it reaches as if the Earth were 4/3 larger (flatter).
const EFFECTIVE_EARTH_RADIUS_M = EARTH_RADIUS_M * 4 / 3;
// Ground closer than this to the antenna never blocks it (the antenna's own
// footing / cleared site; the terrain data is too coarse to trust here).
const NEAR_FIELD_IGNORE_M = 10;
// Terrain only blocks a point if it rises more than this above the straight
// line from the antenna to that point (smaller rises are terrain-data noise).
const RIDGE_TOLERANCE_M = 2;
// Beam sheet: at most this many directions, and points along each.
const BEAM_MESH_MAX_ROWS = 360;
// The beam sheet uses every direction (up to 0.05° apart all round), so its
// edge and tip line pass through every stop point.
const BEAM_SHEET_MAX_ROWS = 7200;
const BEAM_RAY_POINTS = 100;
// Lowest height (m) of the beam sheet above the sampled ground.
// Kept a little above it, so the sheet never sits at the same depth as the
// terrain and flickers into it (patchy green showing the map through).
const BEAM_GROUND_CLEARANCE_M = 2;
// Beam points higher than this above the sampled ground are left where they
// are when the beam is placed on the terrain as drawn: the drawn tiles are
// never that far off, so they cannot reach them.
const BEAM_RESEAT_MARGIN_M = 60;
// Samples placed on the drawn terrain per frame, so the map never stalls.
const BEAM_RESEAT_PER_FRAME = 3000;
// Faint range rings on the beam, as fractions of the range.
const RANGE_RING_FRACTIONS = [0.25, 0.5, 0.75];
const RANGE_RING_COLOR = Cesium.Color.WHITE.withAlpha(0.35);
const RAY_LINE_COLOR = Cesium.Color.WHITE.withAlpha(0.5);
// Stop points ("all green + stop points" view): size in pixels.
const STOP_POINT_PX = 6;
// "0° up to this angle" figures: points along each direction of the green
// (seen air) figure, and at most this many range samples along each
// direction of the red (hidden air) surface.
const VOLUME_POINTS = 160;
const SHADOW_VOLUME_POINTS = 400;
// Where the figure's bottom comes within this of the ground (the beam
// touching the terrain) it is left open, so the ground footprint shows.
const VOLUME_GROUND_CLEARANCE_M = 15;
// Step walls: drawn where a direction reaches further than its neighbour by
// more than STEP_MIN_M and STEP_FRACTION of its own length; their detail.
const STEP_MIN_M = 150;
const STEP_FRACTION = 0.1;
const STEP_WALL_POINTS = 24;
// Ground counts as seen when something this tall standing on it is seen. On
// flat land the ground lies right on the radar's horizon, and the terrain
// tiles there are off from each other by a few metres, which would otherwise
// paint whole tiles green or red (square patches) instead of following hills.
const GROUND_TARGET_HEIGHT_M = 3;
// Shading of the lit figure: how high above the horizon the light is
// (relative weight).
const SHADE_LIGHT_UP = 0.5;
// Camera height (m) above the ground beyond which a coverage mesh is drawn
// over the terrain, because the coarse tiles shown from there no longer match it.
const FAR_VIEW_HEIGHT_M = 10000;
// Blocked sectors separated by a clear gap narrower than this are one sector
// in the panel list and map labels (the map shading keeps every gap).
const SECTOR_MERGE_GAP_DEG = 1;
// Map labels: the widest sectors only, and none narrower than MIN_LABEL_WIDTH_DEG
// (those are still in the panel list).
const MAX_SECTOR_LABELS = 6;
const MIN_LABEL_WIDTH_DEG = 3;
const LABEL_MIN_RANGE_FRACTION = 0.45;
// Bins of the horizon profile handed to the panel chart.
const HORIZON_BINS = 180;
// Footprint texture: largest side in pixels, and footprints kept from
// earlier builds (it does not change with the beam angle, so the angle
// slider and the scan reuse it).
const FOOTPRINT_TEXTURE_MAX_PX = 1024;
const FOOTPRINT_CACHE_SIZE = 4;
// Footprint visibility score is clamped to +-this (metres), so edges blend.
const FOOTPRINT_SCORE_CLAMP_M = 25;

// =============================================================================
// CesiumRadarCoverage: one beam at one angle, cut by terrain
// =============================================================================

export class CesiumRadarCoverage {
    // Beam settings stored on a radar entity's properties. Older radars kept
    // the range per zone; that is used when no beam range is set.
    static beamOf(props: Record<string, any>): BeamSettings {
        const widthDeg = props["beamWidthDeg"] ?? DEFAULT_BEAM.widthDeg;
        return {
            azimuthDeg: props["beamAzimuthDeg"] ?? DEFAULT_BEAM.azimuthDeg,
            widthDeg,
            range: props["beamRange"] ?? props["zoneRanges"]?.["Coverage Zone"] ?? DEFAULT_BEAM.range,
            elevationDeg: props["beamElevationDeg"] ?? DEFAULT_BEAM.elevationDeg,
            targetHeightAgl: props["targetHeightAgl"] ?? DEFAULT_TARGET_HEIGHT_AGL_M,
            mastHeight: props["antennaMastHeight"] ?? DEFAULT_MAST_HEIGHT_M
        };
    }

    static styleOf(props: Record<string, any>): RadarStyle {
        return {
            beamOpacity: props["beamOpacity"] ?? DEFAULT_RADAR_STYLE.beamOpacity,
            showBeam: props["showBeam"] ?? DEFAULT_RADAR_STYLE.showBeam,
            showReach: props["showReach"] ?? DEFAULT_RADAR_STYLE.showReach,
            showBlocked: props["showBlocked"] ?? DEFAULT_RADAR_STYLE.showBlocked,
            showLabels: props["showLabels"] ?? DEFAULT_RADAR_STYLE.showLabels,
            showLowerBeams: props["showLowerBeams"] ?? DEFAULT_RADAR_STYLE.showLowerBeams,
            volumeLit: props["volumeLit"] ?? DEFAULT_RADAR_STYLE.volumeLit,
            volumeTransparent: props["volumeTransparent"] ?? DEFAULT_RADAR_STYLE.volumeTransparent,
            volumeLight: props["volumeLight"] ?? DEFAULT_RADAR_STYLE.volumeLight,
            showStopPoints: props["showStopPoints"] ?? DEFAULT_RADAR_STYLE.showStopPoints,
            showRays: props["showRays"] ?? DEFAULT_RADAR_STYLE.showRays,
            volumeOpacity: props["volumeOpacity"] ?? DEFAULT_RADAR_STYLE.volumeOpacity,
            showFootprint: props["showFootprint"] ?? DEFAULT_RADAR_STYLE.showFootprint,
            showWedgeFootprint: props["showWedgeFootprint"] ?? DEFAULT_RADAR_STYLE.showWedgeFootprint,
            footprintOpacity: props["footprintOpacity"] ?? DEFAULT_RADAR_STYLE.footprintOpacity
        };
    }

    // -------------------------------------------------------------------
    // 1. Main entry point
    // -------------------------------------------------------------------
    static async create3DRadarZones(
        viewer: Cesium.Viewer,
        terrainProvider: Cesium.TerrainProvider,
        options: RadarOptions
    ): Promise<RadarCoverageHandle[]> {
        // Anything already drawn is removed again if the build fails part way,
        // so a failed build never leaves pieces of itself on the map.
        const handles: RadarCoverageHandle[] = [];
        try {
            await CesiumRadarCoverage.buildInto(viewer, terrainProvider, options, handles);
            return handles;
        } catch (err) {
            for (const handle of handles) handle.dispose();
            throw err;
        }
    }

    private static async buildInto(
        viewer: Cesium.Viewer,
        terrainProvider: Cesium.TerrainProvider,
        options: RadarOptions,
        handles: RadarCoverageHandle[]
    ): Promise<void> {

        const { entityId, longitude, latitude } = options;
        const mastHeight = Math.max(0, options.beam.mastHeight);

        // Ground polylines are built synchronously, so the old coverage is only
        // swapped out once the new one is ready to draw (no flicker while scanning).
        await Cesium.GroundPolylinePrimitive.initializeTerrainHeights();

        const cartographic = Cesium.Cartographic.fromDegrees(longitude, latitude);
        const [sampled] = await Cesium.sampleTerrainMostDetailed(terrainProvider, [cartographic]);
        const terrainHeight = sampled.height ?? 0;
        const radarHeight = terrainHeight + mastHeight;
        const radarPosition = Cesium.Cartesian3.fromDegrees(longitude, latitude, radarHeight);
        const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(radarPosition);

        // Emitter marker
        const marker = viewer.entities.add({
            position: radarPosition,
            point: {
                pixelSize: 16,
                color: Cesium.Color.BLACK,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        (marker as any).radarParentId = entityId;
        // Clicking the radar itself always selects it.
        (marker as any).isRadarMarker = true;
        handles.push({ dispose: () => viewer.entities.remove(marker) });

        // The beam
        const elevationDeg = options.beam.elevationDeg;
        const widthDeg = Cesium.Math.clamp(options.beam.widthDeg, 1, 360);
        const wrap = widthDeg >= 360;
        const zone: ResolvedZone = {
            name: "Beam",
            color: CLEAR_COLOR,
            range: Math.max(100, options.beam.range),
            minElevationDeg: elevationDeg,
            maxElevationDeg: elevationDeg,
            azimuthStartDeg: wrap ? 0 : options.beam.azimuthDeg - widthDeg / 2,
            azimuthWidthDeg: widthDeg
        };
        // Terrain along every direction of the beam (cached: changing only the
        // angle reuses it, which is what keeps the angle slider and scan live).
        const azimuthStepDeg = options.azimuthStepDeg ?? Cesium.Math.clamp(
            widthDeg / TARGET_RAYS_ACROSS_BEAM, MIN_AZIMUTH_STEP_DEG, MAX_AZIMUTH_STEP_DEG
        );
        const sampleSpacing = Cesium.Math.clamp(options.sampleSpacingM ?? TERRAIN_SAMPLE_SPACING_M, 1, 500);
        const azimuthsDeg = CesiumRadarCoverage.buildAzimuthList(zone.azimuthStartDeg, widthDeg, azimuthStepDeg);
        const profiles = await CesiumRadarCoverage.getTerrainProfiles(
            terrainProvider,
            `${longitude}|${latitude}|${zone.azimuthStartDeg}|${widthDeg}|${azimuthStepDeg}|${sampleSpacing}`,
            radarPosition,
            enuMatrix,
            azimuthsDeg,
            zone.range,
            sampleSpacing
        );

        const rows = profiles.length;
        const rowStepDeg = wrap ? 360 / rows : widthDeg / Math.max(1, rows - 1);
        const grid: RayGrid = {
            zone,
            wrap,
            profiles,
            rays: profiles.map(p => CesiumRadarCoverage.traceRay(p, radarHeight)),
            rowAz: profiles.map((_, r) => zone.azimuthStartDeg + rowStepDeg * r),
            rowStepDeg,
            enuMatrix
        };

        // Where the beam ends in every direction.
        const angle = Cesium.Math.toRadians(elevationDeg);
        const lastCol = CesiumRadarCoverage.lastColumn(grid);
        const tips: BeamTips = {
            dist: new Float64Array(rows),
            hit: new Uint8Array(rows),
            clearDeg: new Float64Array(rows)
        };
        for (let r = 0; r < rows; r++) {
            const tip = CesiumRadarCoverage.rayTip(grid, r, angle, lastCol);
            tips.dist[r] = tip.dist;
            tips.hit[r] = tip.hit ? 1 : 0;
            const peak = grid.rays[r].peakAngle[lastCol];
            tips.clearDeg[r] = Number.isFinite(peak) ? Cesium.Math.toDegrees(peak) : -90;
        }
        const runs = CesiumRadarCoverage.blockedRuns(tips.hit, wrap);
        const scan = CesiumRadarCoverage.summarise(grid, tips, runs, elevationDeg);


        // The wedge every "0° up to this angle" layer and the footprint keep
        // inside: from 0° up to the beam's angle (down to it, below 0°).
        const wedgeTop = Math.max(0, angle);
        const wedgeFloor = Math.min(0, angle);

        const beam = CesiumRadarCoverage.buildBeam(viewer, entityId, grid, tips, radarHeight, angle, lastCol);
        const lower = CesiumRadarCoverage.buildLowerBeams(viewer, entityId, grid, radarHeight, wedgeTop, wedgeFloor, lastCol);
        const footprint = CesiumRadarCoverage.buildFootprint(
            viewer, entityId, grid, longitude, latitude, wedgeTop, wedgeFloor,
            `${longitude}|${latitude}|${radarHeight}|${zone.azimuthStartDeg}|${widthDeg}|${zone.range}|${rows}|${elevationDeg}`);
        const labels = CesiumRadarCoverage.buildSectorLabels(viewer, entityId, grid, tips, scan.sectors, lastCol, radarPosition);
        handles.push(beam, lower, footprint, labels);

        const applyStyle = (st: RadarStyle) => {
            beam.setStyle(st);
            lower.setStyle(st);
            footprint.setStyle(st);
            labels.setStyle(st);
            viewer.scene.requestRender();
        };
        applyStyle(options.style);
        handles.push({ dispose: () => { }, setStyle: applyStyle, scan });

        viewer.scene.requestRender();
    }

    // -------------------------------------------------------------------
    // 2. Terrain seen along one direction: traceRay
    // -------------------------------------------------------------------
    // peakAngle is the steepest line from the antenna that still touches
    // terrain so far (less the small-rise tolerance), so a ray at angle a runs
    // the full range exactly when a > peakAngle at the last sample.
    private static traceRay(profile: TerrainProfile, radarHeight: number): RayTrace {
        const { horizontalDistances: dists, groundHeights } = profile;
        const n = dists.length;
        const groundAngle = new Float32Array(n).fill(-Math.PI / 2);
        const peakAngle = new Float32Array(n).fill(-Infinity);
        for (let i = 1; i < n; i++) {
            const d = dists[i];
            groundAngle[i] = CesiumRadarCoverage.elevationAngle(groundHeights[i], d, radarHeight);
            peakAngle[i] = d < NEAR_FIELD_IGNORE_M
                ? peakAngle[i - 1]
                : Math.max(peakAngle[i - 1], Math.atan(CesiumRadarCoverage.horizonTan(groundAngle[i], d)));
        }
        return { groundAngle, peakAngle };
    }

    // Last range sample that is within the beam's range.
    private static lastColumn(grid: RayGrid): number {
        const dists = grid.profiles[0].horizontalDistances;
        let c = dists.length - 1;
        while (c > 0 && dists[c] > grid.zone.range) c--;
        return c;
    }

    // Where a ray at `angle` (radians) along grid row r first meets the
    // terrain: the first sample whose ground is at or above the ray, found by
    // binary search on the running highest ground angle, then the exact
    // crossing between that sample and the one before. hit = false: the ray
    // stays above the terrain out to the full range.
    private static rayTip(grid: RayGrid, r: number, angle: number, lastCol: number): { dist: number; hit: boolean } {
        const { peakAngle, groundAngle } = grid.rays[r];
        const dists = grid.profiles[r].horizontalDistances;
        if (!(peakAngle[lastCol] >= angle)) return { dist: dists[lastCol], hit: false };
        let lo = 1, hi = lastCol;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (peakAngle[mid] >= angle) hi = mid;
            else lo = mid + 1;
        }
        const a0 = groundAngle[lo - 1], a1 = groundAngle[lo];
        const t = a1 > a0 ? Cesium.Math.clamp((angle - a0) / (a1 - a0), 0, 1) : 0;
        return { dist: dists[lo - 1] + (dists[lo] - dists[lo - 1]) * t, hit: true };
    }

    // Ground point (lon, lat in radians, terrain height) at a distance along grid row r.
    private static groundAt(grid: RayGrid, r: number, d: number, lastCol: number) {
        const { horizontalDistances: dists, groundHeights: heights, groundPoints: pts } = grid.profiles[r];
        const spacing = dists.length > 1 ? dists[1] - dists[0] : TERRAIN_SAMPLE_SPACING_M;
        const f = Math.min(Math.max(0, d) / spacing, lastCol);
        const i0 = Math.floor(f), i1 = Math.min(i0 + 1, lastCol), u = f - i0;
        return {
            lon: pts[i0].longitude + (pts[i1].longitude - pts[i0].longitude) * u,
            lat: pts[i0].latitude + (pts[i1].latitude - pts[i0].latitude) * u,
            height: heights[i0] + (heights[i1] - heights[i0]) * u
        };
    }

    // -------------------------------------------------------------------
    // 3. Blocked stretches of directions
    // -------------------------------------------------------------------
    // Contiguous rows whose ray meets the terrain, as [first, last] row. On an
    // all-round beam a run may wrap past the last row (last < first), and a
    // beam blocked all round is one run [0, rows - 1].
    private static blockedRuns(hit: Uint8Array, wrap: boolean): [number, number][] {
        const rows = hit.length;
        const runs: [number, number][] = [];
        let r = 0;
        while (r < rows) {
            if (!hit[r]) { r++; continue; }
            const from = r;
            while (r < rows && hit[r]) r++;
            runs.push([from, r - 1]);
        }
        if (wrap && runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === rows - 1) {
            const last = runs.pop()!;
            runs[0] = [last[0], runs[0][1]];
        }
        return runs;
    }

    private static runRows(run: [number, number], rows: number): number[] {
        const [from, to] = run;
        const count = to >= from ? to - from + 1 : rows - from + to + 1;
        return Array.from({ length: count }, (_, k) => (from + k) % rows);
    }

    // Panel summary: blocked sectors (small clear gaps merged), how much of
    // the beam is clear, and the lowest angle that clears every direction.
    private static summarise(grid: RayGrid, tips: BeamTips, runs: [number, number][], elevationDeg: number): BeamScanResult {
        const rows = tips.hit.length;
        const { zone, rowAz, rowStepDeg } = grid;
        const norm = (a: number) => ((a % 360) + 360) % 360;

        // Merge runs separated by a narrow clear gap.
        const maxGapRows = Math.max(0, Math.floor(SECTOR_MERGE_GAP_DEG / rowStepDeg));
        const merged: [number, number][] = [];
        for (const run of runs) {
            const prev = merged[merged.length - 1];
            if (prev && run[0] - prev[1] - 1 <= maxGapRows && run[0] > prev[1]) prev[1] = run[1];
            else merged.push([run[0], run[1]]);
        }
        if (grid.wrap && merged.length > 1) {
            const first = merged[0], last = merged[merged.length - 1];
            const gap = (first[0] - last[1] - 1 + rows) % rows;
            if (last[1] >= last[0] && gap <= maxGapRows) {
                merged.pop();
                merged[0] = [last[0], first[1]];
            }
        }

        const sectors: BlockedSector[] = merged.map(run => {
            const rs = CesiumRadarCoverage.runRows(run, rows);
            let nearest = Infinity, clear = -90;
            for (const r of rs) {
                if (tips.hit[r]) nearest = Math.min(nearest, tips.dist[r]);
                clear = Math.max(clear, tips.clearDeg[r]);
            }
            const widthDeg = Math.min(zone.azimuthWidthDeg, rs.length * rowStepDeg);
            return {
                fromDeg: norm(rowAz[run[0]] - rowStepDeg / 2),
                toDeg: norm(rowAz[run[1]] + rowStepDeg / 2),
                widthDeg,
                nearestHitM: nearest,
                clearDeg: clear,
                // Merging small gaps can make a sector wrap all the way round;
                // it is only "all round" when no direction in it is clear.
                allRound: grid.wrap && rs.length >= rows && rs.every(r => tips.hit[r])
            };
        });
        sectors.sort((a, b) => b.widthDeg - a.widthDeg);

        let blockedRows = 0, allClear = -90;
        for (let r = 0; r < rows; r++) {
            blockedRows += tips.hit[r];
            allClear = Math.max(allClear, tips.clearDeg[r]);
        }

        // Horizon profile, binned (highest clear angle in each bin).
        const bins = Math.min(HORIZON_BINS, rows);
        const horizon = Array.from({ length: bins }, (_, b) => {
            const r0 = Math.floor((b * rows) / bins), r1 = Math.floor(((b + 1) * rows) / bins);
            let c = -90;
            for (let r = r0; r < Math.max(r1, r0 + 1); r++) c = Math.max(c, tips.clearDeg[r]);
            return { azDeg: rowAz[Math.min(rows - 1, Math.floor((r0 + r1) / 2))], clearDeg: c };
        });

        return {
            elevationDeg,
            startDeg: zone.azimuthStartDeg,
            widthDeg: zone.azimuthWidthDeg,
            range: zone.range,
            clearPct: (100 * (rows - blockedRows)) / rows,
            allClearDeg: allClear,
            sectors,
            horizon
        };
    }

    // -------------------------------------------------------------------
    // 4. The beam sheet: buildBeam
    // -------------------------------------------------------------------
    // One surface at the beam's angle: every direction's ray runs out until
    // it meets the terrain or to the full range. Directions that run the full
    // range are green, directions stopped by terrain are red. The edge line
    // joins the ray tips: in the air at the far end, or on the hill that
    // stops the beam.
    private static buildBeam(
        viewer: Cesium.Viewer,
        entityId: string,
        grid: RayGrid,
        tips: BeamTips,
        radarHeight: number,
        angle: number,
        lastCol: number
    ): RadarCoverageHandle & { setStyle(st: RadarStyle): void } {
        const { wrap, profiles } = grid;
        const rows = profiles.length;
        const R = Math.min(rows, BEAM_SHEET_MAX_ROWS);
        const rowIdx = Array.from({ length: R }, (_, k) => wrap
            ? Math.floor((k * rows) / R)
            : Math.round((k * (rows - 1)) / Math.max(1, R - 1)));
        const C = BEAM_RAY_POINTS;

        // Every point of the beam is kept as how it was made (where it is, the
        // beam's height there, whether it lies on the ground) rather than as a
        // fixed position, so it can be placed again on the terrain as Cesium
        // draws it: zoomed out, the drawn tiles sit above or below the detailed
        // heights the beam is worked out on, and the beam would sink into
        // them or float over them where it meets the ground (see seat below).
        // The sheet is flat between its points along a direction (one every
        // `step`), so a point in the air clears the highest ground sampled
        // within a step either side of it (sTop), not just the ground under
        // it (sGround): then no bump between two points rises through the
        // sheet. Ground behind where the beam meets a hill is left out (the
        // sheet ends on that hill). A point on the ground stays on it.
        const step = grid.zone.range / (C - 1);
        const dists = grid.profiles[0].horizontalDistances;
        const spacing = dists.length > 1 ? dists[1] - dists[0] : TERRAIN_SAMPLE_SPACING_M;
        const groundTopNear = (row: number, d: number, fallback: number) => {
            const heights = grid.profiles[row].groundHeights;
            const until = tips.hit[row] ? Math.min(d + step, tips.dist[row]) : d + step;
            const i0 = Math.max(1, Math.ceil((d - step) / spacing));
            const i1 = Math.min(lastCol, Math.floor(until / spacing));
            let top = fallback;
            for (let i = i0; i <= i1; i++) {
                if (dists[i] >= NEAR_FIELD_IGNORE_M) top = Math.max(top, heights[i]);
            }
            return top;
        };
        const sLon: number[] = [], sLat: number[] = [], sAir: number[] = [], sGround: number[] = [], sTop: number[] = [];
        const sample = (row: number, d: number, onGround: boolean) => {
            const g = CesiumRadarCoverage.groundAt(grid, row, d, lastCol);
            sLon.push(g.lon);
            sLat.push(g.lat);
            sGround.push(g.height);
            sTop.push(onGround ? g.height : groundTopNear(row, d, g.height));
            sAir.push(onGround ? -Infinity : CesiumRadarCoverage.beamHeightAt(angle, d, radarHeight));
            return sLon.length - 1;
        };
        // Every polyline needs its own material: a PolylineCollection destroys
        // each line's material when it is removed, so a shared one would be
        // destroyed twice and throw, leaving the rest of the old beam behind.
        const lineMaterial = (color: Cesium.Color) => Cesium.Material.fromType("Color", { color });
        // A point: one sample, or halfway between two.
        type BeamPoint = number | [number, number];
        // A point on a direction as the beam runs there: in the air, or on
        // the ground past where the terrain stops it.
        const rayPoint = (row: number, d: number): BeamPoint =>
            sample(row, d, !!tips.hit[row] && d >= tips.dist[row]);
        // Halfway between direction `own` (as the beam runs on it) and its
        // neighbour at the beam's height (whether or not the beam still runs
        // there), at distance d: the line where their slices meet.
        const midPoint = (own: number, other: number, d: number): BeamPoint =>
            [rayPoint(own, d) as number, sample(other, d, false)];

        // Every direction owns the slice of the sheet halfway to each
        // neighbour, out to its own end. A direction stopped early by a hill
        // leaves a gap of its own width behind the hill (its shadow), with a
        // stepped edge, instead of a long slanted triangle joining its short
        // ray to its neighbour's long one.
        const pairs = wrap ? R : R - 1;
        const meshPoints: BeamPoint[] = [];
        const rowD = (row: number) => Array.from({ length: C }, (_, j) => (tips.dist[row] * j) / (C - 1));
        for (let k = 0; k < R; k++) {
            const row = rowIdx[k];
            for (const d of rowD(row)) meshPoints.push(rayPoint(row, d));
        }
        // Joins a direction's own points to the line it shares with its
        // neighbour, both running out from the radar, stepping along
        // whichever has the nearer next point.
        const zip = (own: number[], ownD: number[], mid: number[], midD: number[], target: number[]) => {
            let i = 0, m = 0;
            while (i < own.length - 1 || m < mid.length - 1) {
                if (m >= mid.length - 1 || (i < own.length - 1 && ownD[i + 1] <= midD[m + 1])) {
                    target.push(own[i], own[i + 1], mid[m]);
                    i++;
                } else {
                    target.push(own[i], mid[m + 1], mid[m]);
                    m++;
                }
            }
        };
        // Two surfaces: directions where the beam clears the terrain (green)
        // and directions stopped by it (red), switched on and off separately.
        const clearIndices: number[] = [];
        const blockedIndices: number[] = [];
        for (let k = 0; k < pairs; k++) {
            const k2 = (k + 1) % R;
            const rowA = rowIdx[k], rowB = rowIdx[k2];
            const dA = rowD(rowA), dB = rowD(rowB);
            const short = Math.min(tips.dist[rowA], tips.dist[rowB]);
            const longK = tips.dist[rowA] >= tips.dist[rowB] ? k : k2;
            const longRow = rowIdx[longK], shortRow = longK === k ? rowB : rowA;
            // The line where the two halves meet, one line for both (so no
            // crack opens between them): out to the shorter direction's end at
            // both directions' distances, then on beside the longer one alone.
            const midD: number[] = [];
            const midIdx: number[] = [];
            const shared = [...dA, ...dB].filter(d => d <= short).sort((a, b) => a - b);
            for (const d of shared) {
                if (midD.length && d - midD[midD.length - 1] < 1e-6) continue;
                midD.push(d);
                midIdx.push(meshPoints.push([sample(rowA, d, false), sample(rowB, d, false)]) - 1);
            }
            const longD = rowD(longRow);
            for (let j = 0; j < C; j++) {
                if (longD[j] <= short + 1e-6) continue;
                midD.push(longD[j]);
                midIdx.push(meshPoints.push([longK * C + j, sample(shortRow, longD[j], false)]) - 1);
            }
            // Half next to each of the two directions, out to its own end.
            for (const [own, ownD] of [[k, dA], [k2, dB]] as [number, number[]][]) {
                const row = rowIdx[own];
                const n = midD.findIndex(d => d > tips.dist[row] + 1e-6);
                const end = n < 0 ? midD.length : n;
                zip(Array.from({ length: C }, (_, j) => own * C + j), ownD,
                    midIdx.slice(0, end), midD.slice(0, end), tips.hit[row] ? blockedIndices : clearIndices);
            }
        }

        // Every line, with the points it runs through.
        const linePoints = new Map<Cesium.Polyline, BeamPoint[]>();
        const addLine = (lines: Cesium.PolylineCollection, pts: BeamPoint[], width: number, color: Cesium.Color) =>
            linePoints.set(lines.add({ width, material: lineMaterial(color) }), pts);

        // Range rings and side edges.
        const tipLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
        // Edge where the beam runs the full range (in the air). Directions
        // stopped by terrain get no outline: the sheet's own edge shows them.
        const clearEdgeLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
        const tipOf = (row: number) => rayPoint(row, tips.dist[row]);
        let k = 0;
        while (k < R) {
            const state = tips.hit[rowIdx[k]];
            const pts = [tipOf(rowIdx[k])];
            let next = k + 1;
            while (next < R && tips.hit[rowIdx[next]] === state) pts.push(tipOf(rowIdx[next++]));
            if (!state) {
                // Clear: out to the edge of its slice on either side (where
                // it meets a stopped direction), or round the whole circle.
                const prev = k > 0 ? k - 1 : (wrap ? R - 1 : -1);
                const last = next - 1;
                const allRound = wrap && k === 0 && next >= R;
                if (allRound) pts.push(tipOf(rowIdx[0]));
                else {
                    const first = rowIdx[k], lastRow = rowIdx[last];
                    if (prev >= 0) pts.unshift(midPoint(first, rowIdx[prev], tips.dist[first]));
                    const after = next < R ? next : (wrap ? 0 : -1);
                    if (after >= 0) pts.push(midPoint(lastRow, rowIdx[after], tips.dist[lastRow]));
                }
                if (pts.length >= 2) addLine(clearEdgeLines, pts, 2.5, CLEAR_COLOR);
            }
            k = next;
        }
        // Range rings: drawn only over directions the beam reaches that far.
        for (const fraction of RANGE_RING_FRACTIONS) {
            const d = grid.zone.range * fraction;
            let ring: BeamPoint[] = [];
            const flush = () => {
                if (ring.length >= 2) addLine(tipLines, ring, 1, RANGE_RING_COLOR);
                ring = [];
            };
            for (let k = 0; k <= (wrap ? R : R - 1); k++) {
                const row = rowIdx[k % R];
                if (tips.dist[row] >= d) ring.push(rayPoint(row, d));
                else flush();
            }
            flush();
        }

        // Side edges (beam < 360°).
        if (!wrap) {
            for (const row of [rowIdx[0], rowIdx[R - 1]]) {
                addLine(tipLines, Array.from({ length: C }, (_, j) => rayPoint(row, (tips.dist[row] * j) / (C - 1))),
                    1.5, CLEAR_COLOR);
            }
        }

        // Every ray the terrain is checked on: a straight line from the
        // antenna to where it ends (on the hill that stops it, or at range).
        // Rays that run the full range go with the green, stopped ones with
        // the red, so Show green / Show red switch them too.
        const clearRays = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
        const blockedRays = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
        for (let row = 0; row < rows; row++) {
            addLine(tips.hit[row] ? blockedRays : clearRays, [rayPoint(row, 0), tipOf(row)], 1, RAY_LINE_COLOR);
        }

        // Stop points: where every blocked direction meets the terrain.
        // Hidden by a hill in front, like the beam and its tip line, so a
        // point never shows through a ridge away from its beam. Seen from
        // far away, where the beam is drawn over the terrain, so are they.
        const stopPoints = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection;
        const pointDepth = (far: boolean) => far ? Number.POSITIVE_INFINITY : 0;
        let pointsFar = CesiumRadarCoverage.isFarView(viewer);
        const stopAt: BeamPoint[] = [];
        for (let row = 0; row < rows; row++) {
            if (!tips.hit[row]) continue;
            stopAt.push(tipOf(row));
            stopPoints.add({
                pixelSize: STOP_POINT_PX,
                color: BLOCKED_COLOR,
                outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
                outlineWidth: 1,
                disableDepthTestDistance: pointDepth(pointsFar)
            });
        }
        const removePointsFarListener = viewer.scene.preUpdate.addEventListener(() => {
            if (CesiumRadarCoverage.isFarView(viewer) === pointsFar) return;
            pointsFar = !pointsFar;
            for (let i = 0; i < stopPoints.length; i++) stopPoints.get(i).disableDepthTestDistance = pointDepth(pointsFar);
        });

        // Height of each sample: on the ground, or at the beam's height but
        // never closer to that ground than BEAM_GROUND_CLEARANCE_M (bumps
        // would otherwise rise through the sheet and hide it short of its
        // tip). Built on the detailed heights; seat (below) later moves the
        // samples near the ground onto the terrain as drawn.
        const heights = Float64Array.from(sAir, (air, i) => Math.max(air, sTop[i] + BEAM_GROUND_CLEARANCE_M));
        const nearGround: number[] = [];
        for (let i = 0; i < sAir.length; i++) if (sAir[i] - sTop[i] < BEAM_RESEAT_MARGIN_M) nearGround.push(i);
        const scratch = new Cesium.Cartographic();
        // Samples nearGround[from, to) on the drawn ground (ground not drawn
        // yet counts as the detailed heights). The highest ground near a
        // point is moved by as much as the drawn ground under it differs from
        // the detailed one. Returns whether any moved.
        const placeSamples = (from: number, to: number) => {
            const globe = viewer.scene.globe;
            let moved = false;
            for (let n = from; n < to; n++) {
                const i = nearGround[n];
                scratch.longitude = sLon[i];
                scratch.latitude = sLat[i];
                const drawn = globe.getHeight(scratch) ?? sGround[i];
                const h = Math.max(sAir[i], sTop[i] + drawn - sGround[i] + BEAM_GROUND_CLEARANCE_M);
                if (Math.abs(h - heights[i]) >= 0.5) {
                    heights[i] = h;
                    moved = true;
                }
            }
            return moved;
        };
        const positionOf = (p: BeamPoint): Cesium.Cartesian3 => typeof p === "number"
            ? Cesium.Cartesian3.fromRadians(sLon[p], sLat[p], heights[p])
            : Cesium.Cartesian3.midpoint(positionOf(p[0]), positionOf(p[1]), new Cesium.Cartesian3());
        const positions = new Float64Array(meshPoints.length * 3);
        const placeAll = () => {
            for (let v = 0; v < meshPoints.length; v++) {
                const p = positionOf(meshPoints[v]);
                positions[v * 3] = p.x;
                positions[v * 3 + 1] = p.y;
                positions[v * 3 + 2] = p.z;
            }
            for (const [line, pts] of linePoints) line.positions = pts.map(positionOf);
            for (let i = 0; i < stopAt.length; i++) stopPoints.get(i).position = positionOf(stopAt[i]);
        };
        placeAll();
        const boundingSphere = Cesium.BoundingSphere.fromVertices(Array.from(positions));

        const clearMesh = CesiumRadarCoverage.coloredMesh(viewer, entityId, positions,
            new Uint32Array(clearIndices), boundingSphere, () => [CLEAR_RGB, 1]);
        const blockedMesh = CesiumRadarCoverage.coloredMesh(viewer, entityId, positions,
            new Uint32Array(blockedIndices), boundingSphere, (_, red) => [red ? BLOCKED_RGB : CLEAR_RGB, 1]);

        // Placed again whenever the view settles or new tiles finish loading,
        // a few thousand samples a frame, then redrawn once if any moved.
        // A new request starts over; the build itself never waits for it.
        let seatFrame = 0;
        const seat = () => {
            cancelAnimationFrame(seatFrame);
            let next = 0, moved = false;
            const step = () => {
                const to = Math.min(nearGround.length, next + BEAM_RESEAT_PER_FRAME);
                if (placeSamples(next, to)) moved = true;
                next = to;
                if (next < nearGround.length) {
                    seatFrame = requestAnimationFrame(step);
                    return;
                }
                if (!moved) return;
                placeAll();
                clearMesh.refresh();
                blockedMesh.refresh();
                viewer.scene.requestRender();
            };
            seatFrame = requestAnimationFrame(step);
        };
        seat();
        const removeMoveEndListener = viewer.camera.moveEnd.addEventListener(seat);
        const removeTileListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
            if (queued === 0) seat();
        });

        return {
            dispose: () => {
                clearMesh.dispose();
                blockedMesh.dispose();
                viewer.scene.primitives.remove(tipLines);
                viewer.scene.primitives.remove(clearEdgeLines);
                removePointsFarListener();
                removeMoveEndListener();
                removeTileListener();
                cancelAnimationFrame(seatFrame);
                viewer.scene.primitives.remove(clearRays);
                viewer.scene.primitives.remove(blockedRays);
                viewer.scene.primitives.remove(stopPoints);
            },
            // "Only this angle" mode: Show green = the part of the beam that
            // clears the terrain, Show red = the part stopped by it.
            // Stop-points view: Show green = the whole beam (green), Show red
            // = red points where blocked rays meet the terrain.
            setStyle: (st: RadarStyle) => {
                const thisAngle = !st.showLowerBeams;
                const points = thisAngle && st.showStopPoints;
                const opacity = Cesium.Math.clamp(st.beamOpacity, 0, 1);
                clearMesh.draw(thisAngle && st.showReach ? opacity : 0, false);
                blockedMesh.draw(points
                    ? (st.showReach ? opacity : 0)
                    : (thisAngle && st.showBlocked ? opacity : 0), !points);
                tipLines.show = thisAngle && st.showReach;
                clearRays.show = thisAngle && st.showRays && st.showReach;
                // Stop-points view: the whole beam is green (Show green).
                blockedRays.show = thisAngle && st.showRays && (points ? st.showReach : st.showBlocked);
                // Stop-points view: no outline, the points mark the edge.
                clearEdgeLines.show = thisAngle && !points && st.showReach;
                stopPoints.show = points && st.showBlocked;
            }
        };
    }

    // A triangle mesh with a colour per vertex, redrawn when its opacity or
    // red (whether blocked parts are shown red) changes. colorOf gives each
    // vertex's colour and its alpha relative to the opacity passed to draw.
    private static coloredMesh(
        viewer: Cesium.Viewer,
        entityId: string,
        positions: Float64Array,
        indices: Uint32Array,
        boundingSphere: Cesium.BoundingSphere,
        colorOf: (v: number, red: boolean) => [number[], number]
    ): { draw(opacity: number, red: boolean, light?: number): void; refresh(): void; dispose(): void } {
        const vertexCount = positions.length / 3;
        let primitive: Cesium.Primitive | null = null;
        let builtKey = "";
        let disposed = false;
        let lastDraw: [number, boolean, number] | null = null;
        // Seen from far away the globe shows coarse terrain tiles that sit
        // above or below the detailed heights this mesh was built on, so the
        // ground would punch holes through it. Far away it is drawn over the
        // terrain instead; close up the terrain hides it as usual.
        // Measured as the camera's height above the ground under it, so a low
        // camera looking across a large beam still sees hills hide it.
        const isFar = () => CesiumRadarCoverage.isFarView(viewer);
        let far = isFar();
        const remove = () => {
            if (primitive) viewer.scene.primitives.remove(primitive);
            primitive = null;
        };
        const removeFarListener = viewer.scene.preUpdate.addEventListener(() => {
            if (disposed || isFar() === far) return;
            far = !far;
            if (lastDraw) draw(...lastDraw);
        });
        // lit: shade each face by how it faces a fixed light from above
        // and to the side, the same on both sides (so the figure is
        // shaded inside too). opacity 1: fully opaque (no see-through).
        // light: strength of the shading, 0 = flat (not lit).
        const draw = (opacity: number, red: boolean, light = 0) => {
                lastDraw = [opacity, red, light];
                const key = `${opacity}|${red}|${light}|${far}`;
                const solid = opacity >= 1;
                if (disposed || key === builtKey) return;
                builtKey = key;
                remove();
                if (indices.length === 0 || opacity <= 0) return;
                const colors = new Uint8Array(vertexCount * 4);
                for (let v = 0; v < vertexCount; v++) {
                    const [rgb, alpha] = colorOf(v, red);
                    colors.set([rgb[0], rgb[1], rgb[2], solid ? 255 : Math.round(255 * Math.min(1, opacity * alpha))], v * 4);
                }
                const geometry = new Cesium.Geometry({
                            attributes: {
                                position: new Cesium.GeometryAttribute({
                                    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                                    componentsPerAttribute: 3,
                                    values: positions
                                }),
                                // Per-vertex colour, read by PerInstanceColorAppearance's "color" input.
                                color: new Cesium.GeometryAttribute({
                                    componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
                                    componentsPerAttribute: 4,
                                    normalize: true,
                                    values: colors
                                })
                            } as any,
                            indices,
                            primitiveType: Cesium.PrimitiveType.TRIANGLES,
                            boundingSphere
                        });
                if (light > 0) CesiumRadarCoverage.shadeColors(geometry, colors, boundingSphere.center, light);
                primitive = viewer.scene.primitives.add(new Cesium.Primitive({
                    geometryInstances: new Cesium.GeometryInstance({ geometry }),
                    appearance: new Cesium.PerInstanceColorAppearance({
                        flat: true,
                        translucent: !solid,
                        closed: false,
                        renderState: far ? { depthTest: { enabled: false } } : undefined
                    }),
                    asynchronous: false
                })) as Cesium.Primitive;
                (primitive as any).radarParentId = entityId;
        };
        return {
            dispose: () => {
                disposed = true;
                removeFarListener();
                remove();
            },
            draw,
            // Redraw with the positions changed in place.
            refresh: () => {
                builtKey = "";
                if (lastDraw) draw(...lastDraw);
            }
        };
    }

    // Camera high above the ground under it: the coarse terrain tiles shown
    // from there no longer match the coverage, which is then drawn over them.
    private static isFarView(viewer: Cesium.Viewer): boolean {
        const camera = viewer.camera.positionCartographic;
        const ground = viewer.scene.globe.getHeight(camera) ?? 0;
        return camera.height - ground > FAR_VIEW_HEIGHT_M;
    }

    // Darkens or brightens each vertex colour by how its face turns to a
    // fixed light (above the radar, a little to the south-east). Uses the
    // absolute angle, so both sides of a face are lit alike.
    private static shadeColors(geometry: Cesium.Geometry, colors: Uint8Array, center: Cesium.Cartesian3, strength: number): void {
        Cesium.GeometryPipeline.computeNormal(geometry);
        const normals = (geometry.attributes as any).normal.values as Float32Array;
        delete (geometry.attributes as any).normal;

        const up = Cesium.Cartesian3.normalize(center, new Cesium.Cartesian3());
        const east = Cesium.Cartesian3.normalize(
            Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, up, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const north = Cesium.Cartesian3.cross(up, east, new Cesium.Cartesian3());
        const light = new Cesium.Cartesian3();
        Cesium.Cartesian3.add(
            Cesium.Cartesian3.multiplyByScalar(up, SHADE_LIGHT_UP, new Cesium.Cartesian3()),
            Cesium.Cartesian3.add(
                Cesium.Cartesian3.multiplyByScalar(east, 0.6, new Cesium.Cartesian3()),
                Cesium.Cartesian3.multiplyByScalar(north, -0.45, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()),
            light);
        Cesium.Cartesian3.normalize(light, light);

        for (let v = 0; v < colors.length / 4; v++) {
            const dot = Math.abs(normals[v * 3] * light.x + normals[v * 3 + 1] * light.y + normals[v * 3 + 2] * light.z);
            // A face turned away keeps (1 - strength) of its colour.
            const f = 1 - strength + strength * (Number.isFinite(dot) ? dot : 1);
            for (let c = 0; c < 3; c++) colors[v * 4 + c] = Math.min(255, Math.round(colors[v * 4 + c] * f));
        }
    }

    // -------------------------------------------------------------------
    // 4b. Every angle from the terrain up to the beam: buildLowerBeams
    // -------------------------------------------------------------------
    // The airspace inside the wedge from 0° up to the beam's angle (never
    // below the 0° ray nor the terrain), over the full range, as two solid figures built one slice per direction (each slice
    // spans half way to its neighbours). At every distance along a direction
    // the line of sight over the highest terrain so far splits the air:
    //   green (seen):   from that line (or the ground, where the radar sees
    //                   the ground, or the 0° ray, whichever is highest) up
    //                   to the ray at the beam's angle. A
    //                   slice ends where that ray meets the terrain, or with
    //                   an end wall at the full range; where it reaches
    //                   clearly further than its neighbour, a straight step
    //                   wall closes the step between them. Its bottom is left
    //                   open where it lies on the ground, so the footprint shows.
    //   red (hidden):   from the ground (or the 0° ray, if higher) up to
    //                   that line (capped at the beam's angle): the air nearer terrain hides, shaped
    //                   by the terrain under it (see shadowSurface).
    private static buildLowerBeams(
        viewer: Cesium.Viewer,
        entityId: string,
        grid: RayGrid,
        radarHeight: number,
        topAngle: number,
        floorAngle: number,
        lastCol: number
    ): RadarCoverageHandle & { setStyle(st: RadarStyle): void } {
        const { wrap, profiles, rays } = grid;
        const rows = profiles.length;
        const R = Math.min(rows, BEAM_MESH_MAX_ROWS);
        const rowIdx = Array.from({ length: R }, (_, k) => wrap
            ? Math.floor((k * rows) / R)
            : Math.round((k * (rows - 1)) / Math.max(1, R - 1)));
        const dists = profiles[0].horizontalDistances;
        const spacing = dists.length > 1 ? dists[1] - dists[0] : TERRAIN_SAMPLE_SPACING_M;

        // Where each green slice ends (the top ray), and whether on the terrain.
        const end = new Float64Array(R);
        const endsOnTerrain = new Uint8Array(R);
        for (let r = 0; r < R; r++) {
            const tip = CesiumRadarCoverage.rayTip(grid, rowIdx[r], topAngle, lastCol);
            end[r] = tip.dist;
            endsOnTerrain[r] = tip.hit ? 1 : 0;
        }
        const prevOf = (r: number) => wrap ? (r - 1 + R) % R : r - 1;
        const nextOf = (r: number) => wrap ? (r + 1) % R : (r + 1 < R ? r + 1 : -1);

        const groundH = (r: number, d: number) => CesiumRadarCoverage.groundAt(grid, rowIdx[r], d, lastCol).height;
        // Height of the top (the ray at the beam's angle) at distance d.
        const topAt = (d: number) => CesiumRadarCoverage.beamHeightAt(topAngle, d, radarHeight);
        // Height of the floor (the 0° ray) at distance d.
        const floorAt = (d: number) => CesiumRadarCoverage.beamHeightAt(floorAngle, d, radarHeight);
        // Line of sight over the highest terrain so far along slice r: air
        // below it is hidden, air above it is seen.
        const sightAt = (r: number, d: number) => {
            const peak = rays[rowIdx[r]].peakAngle[Math.min(lastCol, Math.round(d / spacing))];
            return Number.isFinite(peak) ? CesiumRadarCoverage.beamHeightAt(peak, d, radarHeight) : -Infinity;
        };
        // Bottom of the seen air: the line of sight, never below the ground
        // or the floor, nor above the top.
        const bottomAt = (r: number, d: number) =>
            Math.min(topAt(d), Math.max(groundH(r, d), sightAt(r, d), floorAt(d)));
        // Point of slice r at distance d and height h, on its edge towards
        // neighbour n (half way between the two directions), or on the
        // direction itself for an outer edge of the beam (n < 0).
        const point = (r: number, n: number, d: number, h: number) => {
            const a = CesiumRadarCoverage.groundAt(grid, rowIdx[r], d, lastCol);
            if (n < 0) return Cesium.Cartesian3.fromRadians(a.lon, a.lat, h);
            const b = CesiumRadarCoverage.groundAt(grid, rowIdx[n], d, lastCol);
            return Cesium.Cartesian3.fromRadians((a.lon + b.lon) / 2, (a.lat + b.lat) / 2, h);
        };

        // Collects one figure's triangles. strip: quads between two rows of
        // points; keep(i) false leaves out the quad between points i and i + 1.
        const meshBuilder = () => {
            const positions: number[] = [];
            const indices: number[] = [];
            const vertex = (p: Cesium.Cartesian3) => {
                positions.push(p.x, p.y, p.z);
                return positions.length / 3 - 1;
            };
            const strip = (a: Cesium.Cartesian3[], b: Cesium.Cartesian3[], keep: (i: number) => boolean = () => true) => {
                const ia = a.map(vertex);
                const ib = b.map(vertex);
                for (let i = 0; i < a.length - 1; i++) {
                    if (!keep(i)) continue;
                    indices.push(ia[i], ia[i + 1], ib[i], ia[i + 1], ib[i + 1], ib[i]);
                }
            };
            return { positions, indices, strip };
        };
        const seen = meshBuilder();

        for (let r = 0; r < R; r++) {
            const left = prevOf(r), right = nextOf(r);

            // Seen air (green).
            const ds = Array.from({ length: VOLUME_POINTS }, (_, j) => (end[r] * j) / (VOLUME_POINTS - 1));
            const tops = ds.map(topAt);
            const bottoms = ds.map(d => bottomAt(r, d));
            const nearGround = ds.map((d, j) => bottoms[j] - groundH(r, d) < VOLUME_GROUND_CLEARANCE_M);

            // Top, and bottom (open where it lies on the ground).
            seen.strip(ds.map((d, j) => point(r, left, d, tops[j])), ds.map((d, j) => point(r, right, d, tops[j])));
            seen.strip(ds.map((d, j) => point(r, left, d, bottoms[j])), ds.map((d, j) => point(r, right, d, bottoms[j])),
                j => !(nearGround[j] && nearGround[j + 1]));

            // End wall at the full range.
            if (!endsOnTerrain[r]) {
                const d = end[r], b = bottoms[bottoms.length - 1], t = tops[tops.length - 1];
                seen.strip([point(r, left, d, b), point(r, left, d, t)], [point(r, right, d, b), point(r, right, d, t)]);
            }

            // Step walls on both sides (and the beam's outer edges): the
            // slice's cross-section beyond where its neighbour ends.
            for (const n of [left, right]) {
                const outer = n < 0;
                const from = outer ? 0 : Math.min(end[n], end[r]);
                if (!outer && end[r] - from <= Math.max(STEP_MIN_M, STEP_FRACTION * end[r])) continue;
                const ws = Array.from({ length: STEP_WALL_POINTS }, (_, j) =>
                    from + ((end[r] - from) * j) / (STEP_WALL_POINTS - 1));
                seen.strip(ws.map(d => point(r, n, d, bottomAt(r, d))), ws.map(d => point(r, n, d, topAt(d))));
            }
        }

        const toMesh = (m: { positions: number[]; indices: number[] }, rgb: number[]) => CesiumRadarCoverage.coloredMesh(
            viewer, entityId, new Float64Array(m.positions), new Uint32Array(m.indices),
            Cesium.BoundingSphere.fromVertices(m.positions), () => [rgb, 1]);
        const seenMesh = toMesh(seen, CLEAR_RGB);
        const hiddenMesh = toMesh(CesiumRadarCoverage.shadowSurface(grid, rowIdx, radarHeight, topAngle, floorAngle, lastCol), BLOCKED_RGB);

        return {
            dispose: () => {
                seenMesh.dispose();
                hiddenMesh.dispose();
            },
            // The opacity slider is the faces' own opacity: 100% (or not
            // see-through) draws both figures solid.
            setStyle: (st: RadarStyle) => {
                const show = st.showLowerBeams;
                const opacity = st.volumeTransparent ? Cesium.Math.clamp(st.volumeOpacity, 0.05, 1) : 1;
                const light = st.volumeLit ? Cesium.Math.clamp(st.volumeLight, 0, 1) : 0;
                seenMesh.draw(show && st.showReach ? opacity : 0, false, light);
                hiddenMesh.draw(show && st.showBlocked ? opacity : 0, false, light);
            }
        };
    }

    // The hidden (red) air as one surface over every direction and range
    // sample, by the ground footprint's rule. Its base is the ground, or the 0° ray
    // where that is higher (the wedge's floor). Where the line of sight over
    // the nearer terrain passes more than GROUND_TARGET_HEIGHT_M above
    // the base, the top lies on that line (capped at the beam's angle);
    // elsewhere on the base. Only triangles touching hidden air are kept, so
    // the red figure slopes down to its base at its edges (as the footprint
    // blends between directions) instead of ending in walls. Where the base
    // floats above the ground a bottom surface closes it; walls close it at
    // the full range and at the beam's side edges.
    private static shadowSurface(
        grid: RayGrid,
        rowIdx: number[],
        radarHeight: number,
        topAngle: number,
        floorAngle: number,
        lastCol: number
    ): { positions: number[]; indices: number[] } {
        const R = rowIdx.length;
        const dists = grid.profiles[0].horizontalDistances;
        const stride = Math.max(1, Math.ceil(lastCol / SHADOW_VOLUME_POINTS));
        const cols: number[] = [];
        for (let c = 0; c < lastCol; c += stride) cols.push(c);
        cols.push(lastCol);
        const C = cols.length;

        const positions: number[] = [];
        const vertexAt = (k: number, j: number, h: number) => {
            const pt = grid.profiles[rowIdx[k]].groundPoints[cols[j]];
            const p = Cesium.Cartesian3.fromRadians(pt.longitude, pt.latitude, h);
            positions.push(p.x, p.y, p.z);
            return positions.length / 3 - 1;
        };

        // Top vertex k * C + j: direction k, range sample cols[j]; the base
        // vertex under it is R * C later.
        const hidden = new Uint8Array(R * C);
        const floating = new Uint8Array(R * C);
        const bases = new Float64Array(R * C);
        for (let k = 0; k < R; k++) {
            const { groundHeights } = grid.profiles[rowIdx[k]];
            const { peakAngle } = grid.rays[rowIdx[k]];
            for (let j = 0; j < C; j++) {
                const c = cols[j], d = dists[c], g = groundHeights[c];
                const base = Math.max(g, CesiumRadarCoverage.beamHeightAt(floorAngle, d, radarHeight));
                bases[k * C + j] = base;
                if (base > g) floating[k * C + j] = 1;
                let h = base;
                if (c > 0 && d >= NEAR_FIELD_IGNORE_M && Number.isFinite(peakAngle[c - 1])) {
                    const cap = Math.min(
                        CesiumRadarCoverage.beamHeightAt(topAngle, d, radarHeight),
                        CesiumRadarCoverage.beamHeightAt(peakAngle[c - 1], d, radarHeight));
                    if (cap - base > GROUND_TARGET_HEIGHT_M) {
                        h = cap;
                        hidden[k * C + j] = 1;
                    }
                }
                vertexAt(k, j, h);
            }
        }
        for (let k = 0; k < R; k++) {
            for (let j = 0; j < C; j++) vertexAt(k, j, bases[k * C + j]);
        }
        const baseOf = (vtx: number) => R * C + vtx;

        const indices: number[] = [];
        const v = (k: number, j: number) => k * C + j;
        const tri = (a: number, b: number, c: number) => {
            if (!(hidden[a] || hidden[b] || hidden[c])) return;
            indices.push(a, b, c);
            // Bottom, where it floats above the ground (on the ground the
            // terrain itself closes the figure).
            if (floating[a] || floating[b] || floating[c]) indices.push(baseOf(a), baseOf(b), baseOf(c));
        };
        for (let k = 0; k < (grid.wrap ? R : R - 1); k++) {
            const k2 = (k + 1) % R;
            for (let j = 0; j < C - 1; j++) {
                tri(v(k, j), v(k2, j), v(k, j + 1));
                tri(v(k, j + 1), v(k2, j), v(k2, j + 1));
            }
        }

        // Wall from the surface down to its base along the edge between
        // surface vertices (ka, ja) and (kb, jb), where either is hidden.
        const wall = (ka: number, ja: number, kb: number, jb: number) => {
            const a = v(ka, ja), b = v(kb, jb);
            if (!hidden[a] && !hidden[b]) return;
            const ga = baseOf(a), gb = baseOf(b);
            indices.push(a, b, ga, b, gb, ga);
        };
        for (let k = 0; k < (grid.wrap ? R : R - 1); k++) wall(k, C - 1, (k + 1) % R, C - 1);
        if (!grid.wrap) {
            for (const k of [0, R - 1]) {
                for (let j = 0; j < C - 1; j++) wall(k, j, k, j + 1);
            }
        }
        return { positions, indices };
    }

    // -------------------------------------------------------------------
    // 5b. Ground footprint: buildFootprint
    // -------------------------------------------------------------------
    // An image draped on the terrain over the ground inside the wedge (from
    // 0° up to the beam's angle): green where the radar has a clear line of
    // sight to the ground, red where nearer terrain hides it; ground outside
    // the wedge is left unpainted. Each pixel blends the nearest directions
    // and range samples, so the edges run smoothly. Green and red are
    // separate images, so Show green / Show red switch each. Cached, so
    // returning to an angle reuses them.
    private static readonly footprintCache = new Map<string, FootprintImages>();

    private static buildFootprint(
        viewer: Cesium.Viewer,
        entityId: string,
        grid: RayGrid,
        longitude: number,
        latitude: number,
        topAngle: number,
        floorAngle: number,
        cacheKey: string
    ): RadarCoverageHandle & { setStyle(st: RadarStyle): void } {
        const cache = CesiumRadarCoverage.footprintCache;
        let image = cache.get(cacheKey);
        if (image === undefined) {
            image = CesiumRadarCoverage.drawFootprint(grid, longitude, latitude, topAngle, floorAngle);
            while (cache.size >= FOOTPRINT_CACHE_SIZE) cache.delete(cache.keys().next().value!);
        } else {
            cache.delete(cacheKey);
        }
        cache.set(cacheKey, image);

        let fillColor = Cesium.Color.WHITE.withAlpha(DEFAULT_RADAR_STYLE.footprintOpacity);
        const layer = (img: ScoreImage | null) => {
            if (!img) return null;
            const fill = viewer.entities.add({
                rectangle: {
                    coordinates: img.rectangle,
                    material: new Cesium.ImageMaterialProperty({
                        image: img.canvas,
                        transparent: true,
                        color: new Cesium.CallbackProperty(() => fillColor, false)
                    }),
                    classificationType: Cesium.ClassificationType.TERRAIN
                }
            });
            (fill as any).radarParentId = entityId;
            return fill;
        };
        const seenFill = layer(image.seen);
        const hiddenFill = layer(image.hidden);

        return {
            dispose: () => {
                if (seenFill) viewer.entities.remove(seenFill);
                if (hiddenFill) viewer.entities.remove(hiddenFill);
            },
            setStyle: (st: RadarStyle) => {
                const opacity = Cesium.Math.clamp(st.footprintOpacity, 0, 1);
                fillColor = Cesium.Color.WHITE.withAlpha(opacity);
                const on = (st.showLowerBeams ? st.showWedgeFootprint : st.showFootprint) && opacity > 0;
                if (seenFill) seenFill.show = on && st.showReach;
                if (hiddenFill) hiddenFill.show = on && st.showBlocked;
            }
        };
    }

    private static drawFootprint(grid: RayGrid, longitude: number, latitude: number, topAngle: number, floorAngle: number): FootprintImages {
        const dists = grid.profiles[0].horizontalDistances;
        const n = dists.length;
        const clampM = FOOTPRINT_SCORE_CLAMP_M;

        // Per direction and sample: how far (metres) the top of something
        // GROUND_TARGET_HEIGHT_M tall on the ground rises above the line of
        // sight over the nearer terrain (> 0 seen, < 0 hidden); the same rule
        // as the red figure, so the two match.
        const seen = grid.rays.map(({ groundAngle, peakAngle }) => {
            const out = new Float32Array(n).fill(clampM);
            for (let i = 1; i < n; i++) {
                const d = dists[i];
                if (d < NEAR_FIELD_IGNORE_M || !Number.isFinite(peakAngle[i - 1])) continue;
                out[i] = Cesium.Math.clamp(
                    (Math.tan(groundAngle[i]) - Math.tan(peakAngle[i - 1])) * d + GROUND_TARGET_HEIGHT_M, -clampM, clampM);
            }
            return out;
        });
        const inWedge = CesiumRadarCoverage.wedgeScores(grid, topAngle, floorAngle);
        // Soft edge where seen meets hidden; nothing outside the wedge.
        const alpha = (sc: number) => Math.min(1, 0.35 + Math.abs(sc) / 2);
        return {
            seen: CesiumRadarCoverage.drawScoreImage(grid, longitude, latitude, [seen, inWedge],
                ([sc, w]) => w > 0 && sc > 0 ? [SEEN_RGB, alpha(sc)] : null),
            hidden: CesiumRadarCoverage.drawScoreImage(grid, longitude, latitude, [seen, inWedge],
                ([sc, w]) => w > 0 && sc <= 0 ? [HIDDEN_RGB, alpha(sc)] : null)
        };
    }

    // Per direction and sample, in metres: > 0 the ground lies inside the
    // wedge, below the ray at topAngle and above the one at floorAngle.
    private static wedgeScores(grid: RayGrid, topAngle: number, floorAngle: number): Float32Array[] {
        const dists = grid.profiles[0].horizontalDistances;
        const n = dists.length;
        const clampM = FOOTPRINT_SCORE_CLAMP_M;
        const topTan = Math.tan(topAngle), floorTan = Math.tan(floorAngle);
        return grid.rays.map(({ groundAngle }) => {
            const out = new Float32Array(n).fill(clampM);
            for (let i = 1; i < n; i++) {
                const g = Math.tan(groundAngle[i]);
                out[i] = Cesium.Math.clamp(Math.min(topTan - g, g - floorTan) * dists[i], -clampM, clampM);
            }
            return out;
        });
    }

    // An image over the beam's area, to drape on the terrain: each pixel
    // blends the scores of the nearest directions and samples and is painted
    // by paint (colour and alpha 0-1), or left clear when paint gives null.
    private static drawScoreImage(
        grid: RayGrid,
        longitude: number,
        latitude: number,
        scoreSets: Float32Array[][],
        paint: (values: number[]) => [number[], number] | null
    ) {
        const { zone, wrap, profiles, rowStepDeg } = grid;
        const rows = scoreSets[0].length;
        const dists = profiles[0].horizontalDistances;
        const n = dists.length;
        const spacing = n > 1 ? dists[1] - dists[0] : TERRAIN_SAMPLE_SPACING_M;
        const range = zone.range;
        const scoreAt = (seen: Float32Array[], row: number, col: number) => {
            const r0 = Math.floor(row), w = row - r0;
            const c0 = Math.min(Math.floor(col), n - 1), c1 = Math.min(c0 + 1, n - 1), u = col - Math.floor(col);
            const rowScore = (r: number) => {
                if (wrap) r = ((r % rows) + rows) % rows;
                else r = Cesium.Math.clamp(r, 0, rows - 1);
                const sc = seen[r];
                return sc[c0] * (1 - u) + sc[c1] * u;
            };
            return rowScore(r0) * (1 - w) + rowScore(r0 + 1) * w;
        };

        // Bounding box of the beam's area, in metres east / north of the radar.
        const azList: number[] = [];
        for (let k = 0; k <= 64; k++) azList.push(zone.azimuthStartDeg + (zone.azimuthWidthDeg * k) / 64);
        for (let a = 0; a < 360; a += 90) {
            const rel = (((a - zone.azimuthStartDeg) % 360) + 360) % 360;
            if (wrap || rel <= zone.azimuthWidthDeg) azList.push(a);
        }
        let minE = 0, maxE = 0, minN = 0, maxN = 0;
        for (const az of azList) {
            const rad = Cesium.Math.toRadians(az);
            minE = Math.min(minE, Math.sin(rad) * range);
            maxE = Math.max(maxE, Math.sin(rad) * range);
            minN = Math.min(minN, Math.cos(rad) * range);
            maxN = Math.max(maxN, Math.cos(rad) * range);
        }
        const widthM = Math.max(1, maxE - minE);
        const heightM = Math.max(1, maxN - minN);
        const mpp = Math.max(Math.max(widthM, heightM) / FOOTPRINT_TEXTURE_MAX_PX, spacing / 2);
        const texW = Math.max(1, Math.min(FOOTPRINT_TEXTURE_MAX_PX, Math.ceil(widthM / mpp)));
        const texH = Math.max(1, Math.min(FOOTPRINT_TEXTURE_MAX_PX, Math.ceil(heightM / mpp)));
        const mppX = widthM / texW, mppY = heightM / texH;

        const canvas = document.createElement("canvas");
        canvas.width = texW;
        canvas.height = texH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        const img = ctx.createImageData(texW, texH);
        const data = img.data;
        for (let y = 0; y < texH; y++) {
            // Row 0 is the north edge.
            const north = maxN - (y + 0.5) * mppY;
            for (let x = 0; x < texW; x++) {
                const east = minE + (x + 0.5) * mppX;
                const dist = Math.hypot(east, north);
                if (dist > range || dist < NEAR_FIELD_IGNORE_M) continue;
                const az = (Cesium.Math.toDegrees(Math.atan2(east, north)) + 360) % 360;
                const rel = (((az - zone.azimuthStartDeg) % 360) + 360) % 360;
                if (!wrap && rel > zone.azimuthWidthDeg) continue;
                const row = rel / rowStepDeg, col = dist / spacing;
                const painted = paint(scoreSets.map(set => scoreAt(set, row, col)));
                if (!painted) continue;
                const [rgb, alpha] = painted;
                const o = (y * texW + x) * 4;
                data[o] = rgb[0];
                data[o + 1] = rgb[1];
                data[o + 2] = rgb[2];
                data[o + 3] = Math.round(255 * alpha);
            }
        }
        ctx.putImageData(img, 0, 0);

        // WGS84 metres per degree at this latitude.
        const phi = Cesium.Math.toRadians(latitude);
        const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
        const metersPerDegLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
        const rectangle = Cesium.Rectangle.fromDegrees(
            longitude + minE / metersPerDegLon,
            latitude + minN / metersPerDegLat,
            longitude + maxE / metersPerDegLon,
            latitude + maxN / metersPerDegLat
        );
        return { canvas, rectangle };
    }

    // -------------------------------------------------------------------
    // 6. Labels on the widest blocked sectors: buildSectorLabels
    // -------------------------------------------------------------------
    // Placed where the beam first meets the terrain in the sector: bearing
    // range and compass direction, distance, and the angle that clears it.
    private static buildSectorLabels(
        viewer: Cesium.Viewer,
        entityId: string,
        grid: RayGrid,
        tips: BeamTips,
        sectors: BlockedSector[],
        lastCol: number,
        radarPosition: Cesium.Cartesian3
    ): RadarCoverageHandle & { setStyle(st: RadarStyle): void } {
        const labels = viewer.scene.primitives.add(new Cesium.LabelCollection()) as Cesium.LabelCollection;
        const rows = tips.hit.length;
        for (const sector of sectors.filter(sc => sc.widthDeg >= MIN_LABEL_WIDTH_DEG).slice(0, MAX_SECTOR_LABELS)) {
            // The direction in this sector where the beam hits nearest.
            let best = -1;
            for (let r = 0; r < rows; r++) {
                if (!tips.hit[r] || tips.dist[r] !== sector.nearestHitM) continue;
                const rel = (((grid.rowAz[r] - sector.fromDeg) % 360) + 360) % 360;
                if (rel <= sector.widthDeg + grid.rowStepDeg) { best = r; break; }
            }
            if (best < 0) continue;
            // In the middle of the sector, out in its red area: past the hit,
            // and at least LABEL_MIN_RANGE_FRACTION of the range out, so
            // labels of sectors blocked close to the radar do not pile up on it.
            const midRow = sector.allRound ? best : CesiumRadarCoverage.rowNearest(grid,
                sector.fromDeg + sector.widthDeg / 2, best);
            const from = tips.hit[midRow] ? tips.dist[midRow] : sector.nearestHitM;
            const range = grid.zone.range;
            const at = Math.min(range * 0.95, Math.max(from + (range - from) * 0.35, range * LABEL_MIN_RANGE_FRACTION));
            const g = CesiumRadarCoverage.groundAt(grid, midRow, at, lastCol);
            const label = labels.add({
                position: Cesium.Cartesian3.fromRadians(g.lon, g.lat, g.height + 30),
                text: `Blocked ${CesiumRadarCoverage.formatSector(sector)}\n` +
                    `${(sector.nearestHitM / 1000).toFixed(1)} km · clears at ${sector.clearDeg.toFixed(1)}°`,
                font: "12px sans-serif",
                fillColor: Cesium.Color.WHITE,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString("#7f1d1d").withAlpha(0.85),
                backgroundPadding: new Cesium.Cartesian2(6, 4),
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            });
            (label as any).radarParentId = entityId;
        }

        // Once no direction is blocked (the beam is at or above the angle
        // that clears the terrain everywhere), one label over the radar:
        // nothing is in the way above this beam out to the full range.
        const clearLabels = viewer.scene.primitives.add(new Cesium.LabelCollection()) as Cesium.LabelCollection;
        if (rows > 0 && tips.hit.every(h => !h)) {
            const zone = grid.zone;
            const where = grid.wrap ? "all round" : CesiumRadarCoverage.formatSector({
                fromDeg: ((zone.azimuthStartDeg % 360) + 360) % 360,
                toDeg: (((zone.azimuthStartDeg + zone.azimuthWidthDeg) % 360) + 360) % 360,
                widthDeg: zone.azimuthWidthDeg,
                nearestHitM: 0,
                clearDeg: 0,
                allRound: false
            });
            const label = clearLabels.add({
                position: radarPosition,
                text: `The beam clears the terrain in every direction${grid.wrap ? "" : ` (${where})`}, so an
` +
                    `aircraft at the beam's height or above is clear of the terrain out to ${(zone.range / 1000).toFixed(1)} km.`,
                font: "12px sans-serif",
                fillColor: Cesium.Color.WHITE,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString(ALL_CLEAR_LABEL_CSS).withAlpha(0.9),
                backgroundPadding: new Cesium.Cartesian2(6, 4),
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -18),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            });
            (label as any).radarParentId = entityId;
        }

        return {
            dispose: () => {
                viewer.scene.primitives.remove(labels);
                viewer.scene.primitives.remove(clearLabels);
            },
            setStyle: (st: RadarStyle) => {
                const thisAngle = !st.showLowerBeams && !st.showStopPoints;
                // Labels of blocked (red) sectors go with Show red.
                labels.show = thisAngle && st.showLabels && st.showBlocked;
                clearLabels.show = !st.showLowerBeams && st.showReach;
            }
        };
    }

    // Grid row whose direction is nearest this bearing (fallback if none).
    private static rowNearest(grid: RayGrid, bearingDeg: number, fallback: number): number {
        let best = fallback, bestDiff = Infinity;
        grid.rowAz.forEach((az, r) => {
            const diff = Math.abs((((az - bearingDeg) % 360) + 540) % 360 - 180);
            if (diff < bestDiff) { bestDiff = diff; best = r; }
        });
        return best;
    }

    static compassOf(deg: number): string {
        const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
    }

    // "42°–87° (NE)": the bearing range and the compass direction of its middle.
    static formatSector(sector: BlockedSector): string {
        const mid = sector.fromDeg + sector.widthDeg / 2;
        if (sector.allRound) return "all round";
        return `${Math.round(sector.fromDeg)}°–${Math.round(sector.toDeg)}° (${CesiumRadarCoverage.compassOf(mid)})`;
    }

    // -------------------------------------------------------------------
    // 8. Azimuths of the directions across the beam
    // -------------------------------------------------------------------
    private static buildAzimuthList(startDeg: number, sweepDeg: number, stepDeg: number): number[] {
        const sweep = Cesium.Math.clamp(sweepDeg, 1, 360);
        const step = Math.max(0.05, stepDeg);
        const count = Math.max(2, Math.round(sweep / step) + (sweep >= 360 ? 0 : 1));
        const azimuths: number[] = [];
        for (let i = 0; i < count; i++) {
            const raw = startDeg + (sweep * i) / (sweep >= 360 ? count : count - 1);
            azimuths.push(((raw % 360) + 360) % 360);
        }
        return azimuths;
    }

    // -------------------------------------------------------------------
    // 9. Terrain profiles (cached)
    // -------------------------------------------------------------------
    // Sampling terrain is by far the slowest step, and the ground does not change
    // when only the mast height, the beam's angle or a shorter range change.
    // Profiles are therefore kept per radar spot + ray fan, and reused when they
    // already reach far enough.
    private static readonly profileCache = new Map<string, { maxRange: number; profiles: TerrainProfile[] }>();

    private static async getTerrainProfiles(
        terrainProvider: Cesium.TerrainProvider,
        cacheKey: string,
        radarPosition: Cesium.Cartesian3,
        enuMatrix: Cesium.Matrix4,
        azimuthsDeg: number[],
        maxRange: number,
        spacing: number
    ): Promise<TerrainProfile[]> {
        const cache = CesiumRadarCoverage.profileCache;
        const hit = cache.get(cacheKey);
        if (hit && hit.maxRange >= maxRange) {
            cache.delete(cacheKey);
            cache.set(cacheKey, hit);
            return hit.profiles;
        }

        const profiles = await CesiumRadarCoverage.buildTerrainProfiles(
            terrainProvider, radarPosition, enuMatrix, azimuthsDeg, maxRange, spacing
        );
        cache.delete(cacheKey);
        cache.set(cacheKey, { maxRange, profiles });
        while (cache.size > PROFILE_CACHE_SIZE) {
            cache.delete(cache.keys().next().value!);
        }
        return profiles;
    }

    private static async buildTerrainProfiles(
        terrainProvider: Cesium.TerrainProvider,
        radarPosition: Cesium.Cartesian3,
        enuMatrix: Cesium.Matrix4,
        azimuthsDeg: number[],
        maxRange: number,
        spacing: number
    ): Promise<TerrainProfile[]> {
        const sampleCount = Math.max(2, Math.ceil(maxRange / spacing)) + 1;
        const horizontalDistances: number[] = [];
        for (let i = 0; i < sampleCount; i++) {
            horizontalDistances.push(Math.min(i * spacing, maxRange));
        }

        const flatCartographics: Cesium.Cartographic[] = [];
        const scratchPoint = new Cesium.Cartesian3();
        for (const azimuthDeg of azimuthsDeg) {
            const groundRay = CesiumRadarCoverage.makeRay(radarPosition, enuMatrix, azimuthDeg, 0);
            for (const distance of horizontalDistances) {
                const point = Cesium.Ray.getPoint(groundRay, distance, scratchPoint);
                flatCartographics.push(Cesium.Cartographic.fromCartesian(point));
            }
        }

        const sampledTerrain = await Cesium.sampleTerrainMostDetailed(terrainProvider, flatCartographics);

        return azimuthsDeg.map((azimuthDeg, a) => {
            const base = a * sampleCount;
            const groundPoints = sampledTerrain.slice(base, base + sampleCount);
            const groundHeights = CesiumRadarCoverage.fillMissingHeights(groundPoints.map(p => p.height));
            return { azimuthDeg, horizontalDistances, groundHeights, groundPoints };
        });
    }

    // Heights the terrain gave no value for, taken from the nearest samples
    // either side (a missing height read as 0 m would be a deep false hole).
    private static fillMissingHeights(heights: (number | undefined)[]): number[] {
        const ok = (h: number | undefined): h is number => h !== undefined && Number.isFinite(h);
        const out = new Array<number>(heights.length);
        let prev = -1;
        for (let i = 0; i <= heights.length; i++) {
            if (i < heights.length && !ok(heights[i])) continue;
            const prevH = prev >= 0 ? heights[prev] as number : undefined;
            const nextH = i < heights.length ? heights[i] as number : undefined;
            for (let k = prev + 1; k < i; k++) {
                out[k] = prevH !== undefined && nextH !== undefined
                    ? prevH + (nextH - prevH) * (k - prev) / (i - prev)
                    : prevH ?? nextH ?? 0;
            }
            if (i < heights.length) out[i] = nextH as number;
            prev = i;
        }
        return out;
    }

    private static makeRay(
        radarPosition: Cesium.Cartesian3,
        enuMatrix: Cesium.Matrix4,
        azimuthDeg: number,
        elevationDeg: number
    ): Cesium.Ray {
        const azimuth = Cesium.Math.toRadians(azimuthDeg);
        const elevation = Cesium.Math.toRadians(elevationDeg);
        const localDirection = new Cesium.Cartesian3(
            Math.sin(azimuth) * Math.cos(elevation),
            Math.cos(azimuth) * Math.cos(elevation),
            Math.sin(elevation)
        );
        const worldDirection = Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, localDirection, new Cesium.Cartesian3());
        Cesium.Cartesian3.normalize(worldDirection, worldDirection);
        return new Cesium.Ray(radarPosition, worldDirection);
    }

    // -------------------------------------------------------------------
    // 10. Shared line-of-sight maths
    // -------------------------------------------------------------------

    // Slope (tan of the elevation angle) of the lowest line from the antenna
    // that passes no more than RIDGE_TOLERANCE_M below the terrain seen at
    // `angle`, `dist` away. A point further out is hidden by that terrain
    // exactly when its own tan(angle) is below this value.
    static horizonTan(angle: number, dist: number): number {
        return Math.tan(angle) - RIDGE_TOLERANCE_M / dist;
    }

    // Elevation angle from the antenna to ground at this height and distance,
    // with the 4/3-Earth curvature drop applied.
    static elevationAngle(groundHeight: number, dist: number, radarHeight: number): number {
        const curvatureDrop = (dist * dist) / (2 * EFFECTIVE_EARTH_RADIUS_M);
        return Math.atan2(groundHeight - curvatureDrop - radarHeight, dist);
    }

    // Height above the ellipsoid of a straight beam leaving the antenna at this
    // elevation angle, after this horizontal distance (inverse of elevationAngle).
    static beamHeightAt(angle: number, dist: number, radarHeight: number): number {
        return radarHeight + dist * Math.tan(angle) + (dist * dist) / (2 * EFFECTIVE_EARTH_RADIUS_M);
    }
}
