/**
 * EcoWatch Map Module
 * Leaflet satellite map, AOI drawing, heatmap overlay.
 */

let map = null;
let heatLayer = null;
let heatEnabled = false;
let markerGroup = null;
let currentMarker = null;
let labelsLayer = null;

const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_SAT_ATTR = 'Tiles &copy; Esri &mdash; Source: Esri, DigitalGlobe, GeoEye, Earthstar, CNES/Airbus';

const TILE_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_OSM_ATTR = '&copy; OpenStreetMap contributors';

// Place-name labels-only overlay (rendered on top of satellite)
const TILE_LABELS = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png';
const TILE_LABELS_ATTR = '&copy; <a href="https://carto.com/">CARTO</a>';

export function initMap(elementId = 'map') {
    map = L.map(elementId, {
        center: [26.9124, 75.7873],  // Jaipur
        zoom: 11,
        zoomControl: false
    });

    // Satellite basemap (default)
    const satLayer = L.tileLayer(TILE_SAT, { attribution: TILE_SAT_ATTR, maxZoom: 19 }).addTo(map);
    const osmLayer = L.tileLayer(TILE_OSM, { attribution: TILE_OSM_ATTR });

    // Labels overlay — ON by default (shows city/place names over satellite)
    labelsLayer = L.tileLayer(TILE_LABELS, {
        attribution: TILE_LABELS_ATTR,
        maxZoom: 19,
        pane: 'overlayPane'
    }).addTo(map);

    // Layer control
    L.control.layers(
        { '🛰 Satellite': satLayer, '🗺 Streets': osmLayer },
        { '🏷 Place Labels': labelsLayer },
        { position: 'topright' }
    ).addTo(map);

    // Zoom control bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Scale
    L.control.scale({ imperial: false }).addTo(map);

    // Marker group
    markerGroup = L.featureGroup().addTo(map);

    // Click → update coordinates in form
    map.on('click', e => {
        const { lat, lng } = e.latlng;
        const latInput = document.getElementById('input-lat');
        const lonInput = document.getElementById('input-lon');
        if (latInput) latInput.value = lat.toFixed(6);
        if (lonInput) lonInput.value = lng.toFixed(6);
        placeMarker(lat, lng, 'Selected Point');
    });

    return map;
}

export function zoomTo(lat, lng, zoom = 13, label = null) {
    if (!map) return;
    map.flyTo([lat, lng], zoom, { animate: true, duration: 1.5, easeLinearity: 0.25 });
    placeMarker(lat, lng, label);
}

export function toggleLabels(force = null) {
    if (!map || !labelsLayer) return;
    const on = force !== null ? force : !map.hasLayer(labelsLayer);
    if (on) map.addLayer(labelsLayer);
    else map.removeLayer(labelsLayer);
    return on;
}

export function placeMarker(lat, lng, label = null) {
    if (!map) return;
    markerGroup.clearLayers();

    const icon = L.divIcon({
        className: '',
        html: `<div style="
      width:26px;height:26px;
      background:linear-gradient(135deg,#00f5a0,#00c3ff);
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      border:2px solid white;
      box-shadow:0 0 10px rgba(0,245,160,0.6);
    "></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26]
    });

    const marker = L.marker([lat, lng], { icon }).addTo(markerGroup);
    if (label) marker.bindPopup(`<b style="color:#00f5a0">${label}</b><br><small>${lat.toFixed(5)}, ${lng.toFixed(5)}</small>`).openPopup();
    currentMarker = marker;
}

export function toggleHeatmap(analysisHistory = []) {
    if (!map) return false;

    if (heatEnabled) {
        if (heatLayer) map.removeLayer(heatLayer);
        heatEnabled = false;
        return false;
    }

    const points = analysisHistory
        .filter(a => a.coordinates && a.ndvi_change !== undefined)
        .map(a => {
            // Intensity inverse of NDVI change (more negative = hotter)
            const intensity = Math.min(1, Math.max(0, (0.3 - (a.ndvi_change || 0)) / 0.5));
            return [a.coordinates.lat, a.coordinates.lon, intensity];
        });

    if (points.length === 0) {
        // Fallback synthetic heatmap over Jaipur
        const synth = [
            [26.9455, 75.782, 0.9],
            [26.8438, 75.742, 0.6],
            [26.9124, 75.787, 0.3],
            [27.0238, 76.134, 0.2],
            [26.8994, 75.8068, 0.7],
        ];
        points.push(...synth);
    }

    if (!L.heatLayer) {
        console.warn('Leaflet.heat not loaded; heatmap unavailable');
        return false;
    }

    heatLayer = L.heatLayer(points, {
        radius: 40,
        blur: 25,
        maxZoom: 15,
        gradient: { 0.2: '#00f5a0', 0.5: '#ffb830', 0.8: '#ff3864' }
    }).addTo(map);

    heatEnabled = true;
    return true;
}

export function getMap() { return map; }
export function getLabelsLayer() { return labelsLayer; }
