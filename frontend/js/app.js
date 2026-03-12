/**
 * EcoWatch Professional — Core App Logic
 */

import * as API from './api.js';
import * as MapMod from './map.js';

// ── State ────────────────────────────────────────────────────────────
let historyData = [];
let lastResultId = null;
let lastPdfUrl = null;
let alertPollingInterval = null;
let ndviChart = null;
let currentCompareCoords = null; // tracks last compared coords for map-click refresh

// ── Init ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const mapObj = MapMod.initMap('map');
    if (mapObj) {
        mapObj.on('click', async e => {
            const lat = parseFloat(e.latlng.lat.toFixed(6));
            const lon = parseFloat(e.latlng.lng.toFixed(6));
            currentCompareCoords = { lat, lon };

            // 1️⃣ Fill lat/lon in form
            const latI = document.getElementById('input-lat');
            const lonI = document.getElementById('input-lon');
            if (latI) latI.value = lat;
            if (lonI) lonI.value = lon;

            // 2️⃣ Auto-switch to Analysis panel
            activatePanel('analysis');

            // 3️⃣ Reverse geocode → auto-fill Area Name (Nominatim is free)
            const prjI = document.getElementById('input-project');
            toast('📍 Location selected — fetching area name…', 'info', 2000);
            try {
                const r = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
                    { headers: { 'Accept-Language': 'en' } }
                );
                const d = await r.json();
                if (d && d.address) {
                    // Build a clean area name: neighbourhood / suburb / city
                    const addr = d.address;
                    const name = addr.neighbourhood || addr.suburb || addr.village
                        || addr.town || addr.city || addr.county || d.display_name.split(',')[0];
                    if (prjI) prjI.value = name;
                    toast(`✅ Location set: ${name}`, 'success', 3000);
                }
            } catch (_) {
                if (prjI && !prjI.value) prjI.value = `Location ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
                toast(`📍 Coordinates set — enter Area Name manually`, 'info', 2500);
            }

            // 4️⃣ If comparison result already visible, refresh satellite comparison too
            const result = document.getElementById('analysis-result');
            const y1 = parseInt(document.getElementById('input-y1')?.value) || 2022;
            const y2 = parseInt(document.getElementById('input-y2')?.value) || 2024;
            if (result && result.classList.contains('visible')) {
                initSatelliteComparison(lat, lon, y1, y2);
            }
        });
    }
    setupNav();
    setupAnalysisForm();
    setupBossControls();
    setupQuickLocations();
    checkHealth();
    loadHistory();
    alertPollingInterval = setInterval(loadHistory, 30000);
});


// ── Navigation ────────────────────────────────────────────────────────
function setupNav() {
    const navItems = document.querySelectorAll('.nav-item[data-panel]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const panelId = item.dataset.panel;
            activatePanel(panelId);
        });
    });
}

function activatePanel(panelId) {
    // Update nav
    document.querySelectorAll('.nav-item[data-panel]').forEach(i => i.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-panel="${panelId}"]`);
    if (activeNav) activeNav.classList.add('active');

    // Update panels
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`panel-${panelId}`);
    if (panel) panel.classList.add('active');

    // Panel-specific init
    if (panelId === 'reports') renderReports();
    if (panelId === 'alerts') renderAlerts();
    if (panelId === 'dashboard') renderDashboard();
}

// ── Health Check ─────────────────────────────────────────────────────
async function checkHealth() {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    try {
        const h = await API.getHealth();
        if (h.status === 'ok') {
            dot.className = 'status-dot';
            label.textContent = h.mongo === 'connected' ? 'Sentinel-2 Hub: Live' : 'Server: Degraded (No DB)';
            dot.className = h.mongo === 'connected' ? 'status-dot' : 'status-dot degraded';
        }
    } catch {
        if (dot) dot.className = 'status-dot offline';
        if (label) label.textContent = 'Server: Offline';
        toast('Cannot reach server. Is it running?', 'error');
    }
}

// ── History Loading ───────────────────────────────────────────────────
async function loadHistory() {
    try {
        const data = await API.getHistory(100);
        historyData = data.history || [];
        updateAlertBadge();
        // Refresh active panels
        const activePanel = document.querySelector('.panel.active');
        if (activePanel?.id === 'panel-alerts') renderAlerts();
        if (activePanel?.id === 'panel-reports') renderReports();
        if (activePanel?.id === 'panel-dashboard') renderDashboard();
    } catch (e) {
        console.warn('History fetch failed:', e.message);
    }
}

function updateAlertBadge() {
    const high = historyData.filter(h => h.alert_level === 'HIGH').length;
    const badge = document.getElementById('alert-badge');
    if (badge) {
        badge.textContent = high;
        badge.style.display = high > 0 ? '' : 'none';
    }
}

// ── Dashboard Panel ───────────────────────────────────────────────────
function renderDashboard() {
    const total = historyData.length;
    const high = historyData.filter(h => h.alert_level === 'HIGH').length;
    const medium = historyData.filter(h => h.alert_level === 'MEDIUM').length;
    const avgNdvi = total > 0
        ? (historyData.reduce((s, h) => s + (h.ndvi_change || 0), 0) / total).toFixed(3)
        : '—';

    setEl('dash-total', total);
    setEl('dash-high', high);
    setEl('dash-medium', medium);
    setEl('dash-ndvi', avgNdvi);
}

// ── Alerts Panel ──────────────────────────────────────────────────────
function renderAlerts() {
    const container = document.getElementById('alerts-list');
    if (!container) return;

    if (historyData.length === 0) {
        container.innerHTML = emptyState('🛰️', 'No alerts yet. Run an analysis to populate this feed.');
        return;
    }

    // Sort: HIGH first, then MEDIUM, then LOW, then by date
    const sorted = [...historyData].sort((a, b) => {
        const lvl = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        const ld = (lvl[a.alert_level] ?? 3) - (lvl[b.alert_level] ?? 3);
        if (ld !== 0) return ld;
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    container.innerHTML = sorted.map(h => {
        const ndviSign = (h.ndvi_change >= 0 ? '+' : '');
        const ndviClass = h.ndvi_change < 0 ? 'ndvi-neg' : 'ndvi-pos';
        const lat = h.coordinates?.lat?.toFixed(4) ?? '—';
        const lon = h.coordinates?.lon?.toFixed(4) ?? '—';
        const timeAgo = formatTimeAgo(h.timestamp);
        return `
      <div class="alert-item ${h.alert_level}">
        <div class="alert-top">
          <div class="alert-project">${escHtml(h.projectName || 'Unnamed')}</div>
          <span class="alert-badge ${h.alert_level}">${h.alert_level}</span>
        </div>
        <div class="alert-coords">📍 ${lat}, ${lon}</div>
        <div class="alert-ndvi">NDVI Change: <span class="${ndviClass}">${ndviSign}${(h.ndvi_change ?? 0).toFixed(4)}</span>
          &nbsp;|&nbsp; SSIM: <span>${h.ssim_score != null ? h.ssim_score.toFixed(3) : 'N/A'}</span></div>
        <div class="alert-footer">
          <span class="alert-time">${timeAgo}</span>
          <button class="btn-map" onclick="window.ecoZoom(${h.coordinates?.lat}, ${h.coordinates?.lon}, '${escHtml(h.projectName || 'Location')}')">
            🗺 View on Map
          </button>
        </div>
      </div>`;
    }).join('');
}

// ── Analysis Panel ────────────────────────────────────────────────────
function setupQuickLocations() {
    const locs = [
        { label: 'Vidhyadhar Nagar', lat: 26.9455, lon: 75.7820 },
        { label: 'Mansarovar', lat: 26.8438, lon: 75.7424 },
        { label: 'Aravalli Ridge', lat: 27.0238, lon: 76.1347 },
        { label: 'Mumbai BKC', lat: 19.0637, lon: 72.8716 },
    ];

    const wrap = document.getElementById('quick-locs');
    if (!wrap) return;

    wrap.innerHTML = locs.map(l => `
    <button class="quick-loc-btn" onclick="window.ecoQuickLoc(${l.lat}, ${l.lon}, '${l.label}')">
      📍 ${l.label}
    </button>`).join('');
}

function setupAnalysisForm() {
    const form = document.getElementById('analysis-form');
    const btnRun = document.getElementById('btn-run');
    if (!form) return;

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const projectName = document.getElementById('input-project').value.trim();
        const latitude = parseFloat(document.getElementById('input-lat').value);
        const longitude = parseFloat(document.getElementById('input-lon').value);
        const y1 = parseInt(document.getElementById('input-y1').value);
        const y2 = parseInt(document.getElementById('input-y2').value);

        if (!projectName || isNaN(latitude) || isNaN(longitude) || isNaN(y1) || isNaN(y2)) {
            toast('Please fill in all fields.', 'warning'); return;
        }
        if (y1 >= y2) { toast('Year 1 must be before Year 2.', 'warning'); return; }

        btnRun.disabled = true;
        btnRun.innerHTML = '<span class="spinner"></span> Analyzing…';
        toast('Running satellite analysis…', 'info');

        try {
            const resp = await API.runAnalysis({ projectName, latitude, longitude, years: [y1, y2] });
            const res = resp.result;
            lastResultId = resp.mongodb_id;
            lastPdfUrl = resp.pdf_url;

            showAnalysisResult(res, resp);
            MapMod.placeMarker(latitude, longitude, projectName);
            MapMod.zoomTo(latitude, longitude, 13);
            toast(`Analysis complete — Alert: ${res.alert_level}`, res.alert_level === 'HIGH' ? 'error' : res.alert_level === 'MEDIUM' ? 'warning' : 'success');
            await loadHistory();
        } catch (err) {
            toast(`Analysis failed: ${err.message}`, 'error');
            console.error(err);
        } finally {
            btnRun.disabled = false;
            btnRun.innerHTML = '🛰 Run Satellite Analysis';
        }
    });
}

function showAnalysisResult(res, resp) {
    const box = document.getElementById('analysis-result');
    if (!box) return;
    box.classList.add('visible');

    // ── NDVI display: clean format, no double-minus
    const ndviVal = res.ndvi_change ?? 0;
    const sign = ndviVal >= 0 ? '+' : '';
    const metricClass = ndviVal < -0.05 ? 'neg' : ndviVal >= 0 ? 'pos' : '';
    const ndviEl = document.getElementById('res-ndvi');
    if (ndviEl) {
        ndviEl.textContent = sign + ndviVal.toFixed(4);
        ndviEl.className = `metric-val ${metricClass}`;
        ndviEl.title = ndviVal >= 0
            ? '✅ Vegetation increased (healthy)'
            : '⚠️ Vegetation decreased (' + (ndviVal * 100).toFixed(1) + '% change)';
    }

    document.getElementById('res-alert').textContent = res.alert_level;
    document.getElementById('res-alert').className = `result-alert ${res.alert_level}`;
    document.getElementById('res-ssim').textContent = res.ssim_score != null ? res.ssim_score.toFixed(4) : 'N/A';
    const y1ndvi = res.ndvi_year1 != null ? res.ndvi_year1.toFixed(4) : '0.0000';
    const y2ndvi = res.ndvi_year2 != null ? res.ndvi_year2.toFixed(4) : '0.0000';
    document.getElementById('res-y1ndvi').textContent = y1ndvi;
    document.getElementById('res-y2ndvi').textContent = y2ndvi;

    const notesList = document.getElementById('res-notes');
    notesList.innerHTML = (res.notes || []).map(n => `<li>${escHtml(n)}</li>`).join('');

    // NDVI bar chart
    renderNdviChart(res);

    // ── Satellite comparison maps
    const lat = res.coordinates?.lat ?? 26.9124;
    const lon = res.coordinates?.lon ?? 75.7873;
    const y1 = res.years_compared?.[0] ?? 2022;
    const y2 = res.years_compared?.[1] ?? 2024;
    currentCompareCoords = { lat, lon };
    // Pass NDVI data so comparison can draw change markers
    initSatelliteComparison(lat, lon, y1, y2, ndviVal, res.alert_level || 'LOW');

    // ── Add NDVI interpretation label
    const interpEl = document.getElementById('ndvi-interpretation');
    if (interpEl) {
        if (ndviVal < -0.1) {
            interpEl.textContent = '🔴 Significant vegetation loss detected';
            interpEl.style.color = '#dc2626';
        } else if (ndviVal < 0) {
            interpEl.textContent = '🟡 Moderate vegetation decline';
            interpEl.style.color = '#d97706';
        } else {
            interpEl.textContent = '🟢 Vegetation stable or improved';
            interpEl.style.color = '#059669';
        }
    }

    // PDF Button
    const pdfBtn = document.getElementById('btn-pdf');
    if (pdfBtn) {
        if (resp.pdf_url) {
            pdfBtn.style.display = 'flex';
            pdfBtn.onclick = () => { window.open(resp.pdf_url, '_blank'); };
        } else if (lastResultId && lastResultId !== 'null') {
            pdfBtn.style.display = 'flex';
            pdfBtn.onclick = () => { window.open(`/api/analysis/${lastResultId}/report`, '_blank'); };
        } else {
            pdfBtn.style.display = 'none';
        }
    }
}

// ── Satellite Photo Comparison ────────────────────────────────────────
// BEFORE = NASA GIBS MODIS dated Year1  |  AFTER = NASA GIBS MODIS dated Year2
// These are DIFFERENT imagery snapshots — NASA archives daily since 2000
let satMapBefore = null;
let satMapAfter = null;

// NASA GIBS MODIS Terra TrueColor — free, no API key, date-specific archives
// July imagery = peak monsoon greenery in India → best vegetation contrast
function gibsTileUrl(year) {
    const date = `${year}-07-15`;
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible/{z}/{y}/{x}.jpg`;
}

// Esri fallback — shown at lower opacity behind GIBS
const ESRI_SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

function initSatelliteComparison(lat, lon, y1, y2, ndviChange = 0, alertLevel = 'LOW') {
    const wrap = document.getElementById('sat-compare-wrap');
    if (!wrap) return;
    wrap.style.display = 'block';

    // Year labels
    const lblBefore = document.getElementById('sat-label-before');
    const lblAfter = document.getElementById('sat-label-after');
    if (lblBefore) lblBefore.textContent = `◀ ${y1} (Before)`;
    if (lblAfter) lblAfter.textContent = `${y2} (After) ▶`;

    // Source badge & note
    const badge = document.querySelector('.sat-source-badge');
    if (badge) badge.textContent = `NASA GIBS · MODIS Terra · ${y1} vs ${y2}`;
    const note = document.querySelector('.sat-compare-note');
    if (note) note.innerHTML = `Drag ⇔ · <b>Left ${y1}</b> = Baseline &nbsp;|&nbsp; <b>Right ${y2}</b> = Change Zones Marked &nbsp;|&nbsp; <span style="color:#059669">🖱 Click map to update</span>`;

    // Destroy previous instances
    const bEl = document.getElementById('sat-map-before');
    const aEl = document.getElementById('sat-map-after');
    if (!bEl || !aEl) return;

    if (satMapBefore) { try { satMapBefore.remove(); } catch (_) { } satMapBefore = null; }
    if (satMapAfter) { try { satMapAfter.remove(); } catch (_) { } satMapAfter = null; }
    bEl.innerHTML = '';
    aEl.innerHTML = '';

    const mapOpts = {
        center: [lat, lon],
        zoom: 8,
        minZoom: 3,
        maxZoom: 9,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        keyboard: false,
        boxZoom: false
    };

    const gibsOpts = { tileSize: 256, maxNativeZoom: 9, maxZoom: 9 };

    // ── Change severity colour
    const changeColor = alertLevel === 'HIGH' ? '#ef4444'
        : alertLevel === 'MEDIUM' ? '#f59e0b'
            : '#22c55e';
    const sign = ndviChange >= 0 ? '+' : '';
    const isLoss = ndviChange < 0;

    // ══ BEFORE map — Year 1 baseline ══════════════════════════════
    satMapBefore = L.map(bEl, mapOpts);
    L.tileLayer(ESRI_SAT_URL, { tileSize: 256, maxZoom: 9, opacity: 0.5 }).addTo(satMapBefore);
    L.tileLayer(gibsTileUrl(y1), gibsOpts).addTo(satMapBefore);
    // Green baseline rings
    L.circle([lat, lon], { radius: 8000, color: '#22c55e', weight: 2, opacity: 0.7, fillColor: '#22c55e', fillOpacity: 0.07 }).addTo(satMapBefore);
    L.circle([lat, lon], { radius: 3500, color: '#22c55e', weight: 1.5, opacity: 0.55, fillColor: '#22c55e', fillOpacity: 0.12 }).addTo(satMapBefore);
    // "Baseline" label
    L.marker([lat, lon], {
        icon: L.divIcon({
            className: '',
            html: `<div style="background:rgba(0,0,0,0.75);color:#22c55e;font-size:10px;font-weight:700;font-family:monospace;padding:3px 8px;border-radius:6px;white-space:nowrap;border:1.5px solid #22c55e;transform:translateX(-50%) translateY(-40px);position:relative;">📍 ${y1} Baseline</div>`,
            iconSize: [0, 0]
        })
    }).addTo(satMapBefore);
    L.marker([lat, lon], { icon: crosshairIcon('#22c55e') }).addTo(satMapBefore);

    // ══ AFTER map — Year 2 with CHANGE ZONES marked ═══════════════
    satMapAfter = L.map(aEl, mapOpts);
    L.tileLayer(ESRI_SAT_URL, { tileSize: 256, maxZoom: 9, opacity: 0.5 }).addTo(satMapAfter);
    L.tileLayer(gibsTileUrl(y2), gibsOpts).addTo(satMapAfter);

    // Outer halo (wide area affected)
    L.circle([lat, lon], { radius: 14000, color: changeColor, weight: 1, opacity: 0.3, fillColor: changeColor, fillOpacity: 0.04 }).addTo(satMapAfter);
    // Mid ring (core change zone)
    L.circle([lat, lon], { radius: 8000, color: changeColor, weight: 2.5, opacity: 0.75, fillColor: changeColor, fillOpacity: 0.10 }).addTo(satMapAfter);
    // Inner core (highest change density)
    L.circle([lat, lon], { radius: 3500, color: changeColor, weight: 3, opacity: 1, fillColor: changeColor, fillOpacity: isLoss ? 0.28 : 0.15 }).addTo(satMapAfter);

    // Floating NDVI change annotation on after-map
    L.marker([lat, lon], {
        icon: L.divIcon({
            className: '',
            html: `<div style="background:rgba(0,0,0,0.82);color:${changeColor};font-size:10px;font-weight:700;font-family:monospace;padding:4px 10px;border-radius:6px;white-space:nowrap;border:1.5px solid ${changeColor};transform:translateX(-50%) translateY(-44px);position:relative;">${isLoss ? '⚠' : '✅'} NDVI ${sign}${ndviChange.toFixed(4)} · ${alertLevel}</div>`,
            iconSize: [0, 0]
        })
    }).addTo(satMapAfter);
    L.marker([lat, lon], { icon: crosshairIcon(changeColor) }).addTo(satMapAfter);

    setTimeout(() => {
        if (satMapBefore) satMapBefore.invalidateSize();
        if (satMapAfter) satMapAfter.invalidateSize();
    }, 400);

    setupSlider();
}


function crosshairIcon(color = '#ef4444') {
    return L.divIcon({
        className: '',
        html: `<div style="width:18px;height:18px;border:3px solid white;border-radius:50%;
      background:${color};opacity:0.88;box-shadow:0 0 8px ${color}80;
      margin-left:-9px;margin-top:-9px;"></div>`,
        iconSize: [0, 0]
    });
}

function setupSlider() {
    const container = document.getElementById('sat-slider-container');
    const handle = document.getElementById('sat-slider-handle');
    const afterEl = document.getElementById('sat-map-after');
    if (!container || !handle || !afterEl) return;

    let dragging = false;
    let pct = 50; // start at 50%

    function setClip(percent) {
        pct = Math.max(5, Math.min(95, percent));
        const rightClip = 100 - pct;
        afterEl.style.clipPath = `inset(0 ${rightClip}% 0 0)`;
        handle.style.left = `${pct}%`;
    }

    function onMove(clientX) {
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        setClip((x / rect.width) * 100);
    }

    handle.querySelector('.sat-handle-circle').addEventListener('mousedown', e => {
        dragging = true; e.preventDefault();
    });
    document.addEventListener('mousemove', e => { if (dragging) onMove(e.clientX); });
    document.addEventListener('mouseup', () => { dragging = false; });

    // Touch
    handle.querySelector('.sat-handle-circle').addEventListener('touchstart', e => {
        dragging = true; e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', e => {
        if (dragging && e.touches[0]) onMove(e.touches[0].clientX);
    }, { passive: true });
    document.addEventListener('touchend', () => { dragging = false; });

    // Click on container also moves handle
    container.addEventListener('click', e => {
        if (e.target.closest('.sat-handle-circle')) return;
        onMove(e.clientX);
    });

    // Init at 50%
    setClip(50);
}

function renderNdviChart(res) {
    const canvas = document.getElementById('ndvi-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (ndviChart) ndviChart.destroy();

    const y1 = res.years_compared?.[0] ?? 'Year 1';
    const y2 = res.years_compared?.[1] ?? 'Year 2';
    const v1 = res.ndvi_year1 ?? 0;
    const v2 = res.ndvi_year2 ?? 0;

    ndviChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: [String(y1), String(y2)],
            datasets: [{
                label: 'Mean NDVI',
                data: [v1, v2],
                backgroundColor: [
                    'rgba(0,195,255,0.6)',
                    v2 < v1 ? 'rgba(255,56,100,0.6)' : 'rgba(0,245,160,0.6)'
                ],
                borderColor: [
                    '#00c3ff',
                    v2 < v1 ? '#ff3864' : '#00f5a0'
                ],
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` NDVI: ${ctx.raw.toFixed(4)}`
                    }
                }
            },
            scales: {
                y: {
                    min: 0,
                    max: 1,
                    ticks: { color: '#8899bb', font: { family: 'Roboto Mono', size: 11 } },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                    ticks: { color: '#8899bb', font: { family: 'Outfit', size: 12 } },
                    grid: { display: false }
                }
            }
        }
    });
}

// ── Reports Panel ─────────────────────────────────────────────────────
function renderReports() {
    const tbody = document.getElementById('reports-tbody');
    if (!tbody) return;

    if (historyData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)">No reports yet. Run an analysis to generate one.</td></tr>`;
        return;
    }

    tbody.innerHTML = historyData.map((h, i) => {
        const ndviSign = h.ndvi_change >= 0 ? '+' : '';
        const ndviColor = h.ndvi_change < 0 ? 'var(--accent-red)' : 'var(--accent-green)';
        const hasPdf = h.pdf_report || (h._id && !h._id.startsWith('mock'));
        const date = h.timestamp ? new Date(h.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        const lat = h.coordinates?.lat;
        const lon = h.coordinates?.lon;
        const hasSat = lat && lon;
        // NDVI interpretation
        const ndviLabel = h.ndvi_change < -0.1 ? '🔴 High Loss'
            : h.ndvi_change < 0 ? '🟡 Decline'
                : '🟢 Stable';
        return `
      <tr>
        <td>${String(i + 1).padStart(3, '0')}</td>
        <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(h.projectName || '')}">${escHtml(h.projectName || 'Unnamed')}</td>
        <td style="font-family:'Roboto Mono',monospace;font-size:11px;color:${ndviColor}">${ndviSign}${(h.ndvi_change ?? 0).toFixed(4)}<br><span style="font-size:9px;font-family:inherit">${ndviLabel}</span></td>
        <td><span class="alert-badge ${h.alert_level}">${h.alert_level}</span></td>
        <td style="font-size:11px;color:var(--text-muted)">${date}</td>
        <td>
          ${hasSat
                ? `<button class="btn-dl" title="View satellite comparison" onclick="window.ecoViewSatCompare(${lat},${lon},'${escHtml(h.projectName || '')}')">🛰 View</button>`
                : `<span style="font-size:10px;color:var(--text-muted)">N/A</span>`}
        </td>
        <td>
          ${hasPdf
                ? `<button class="btn-dl" onclick="window.ecoDownloadReport('${h._id}')">⬇ PDF</button>`
                : `<button class="btn-dl" disabled title="PDF not generated">N/A</button>`
            }
        </td>
      </tr>`;
    }).join('');
}

// ── Boss Interface ────────────────────────────────────────────────────
function setupBossControls() {
    // Heatmap toggle
    const heatToggle = document.getElementById('toggle-heatmap');
    if (heatToggle) {
        heatToggle.addEventListener('change', () => {
            const on = MapMod.toggleHeatmap(historyData);
            toast(on ? '🔥 Heatmap layer enabled' : 'Heatmap layer disabled', 'info');
        });
    }

    // Satellite labels toggle
    const labelsToggle = document.getElementById('toggle-labels');
    if (labelsToggle) {
        labelsToggle.checked = true; // Labels ON by default
        labelsToggle.addEventListener('change', () => {
            const on = MapMod.toggleLabels(labelsToggle.checked);
            toast(on ? '🏷 Place labels enabled' : 'Place labels hidden', 'info');
        });
    }

    // Boss shield button in header
    const shieldBtn = document.getElementById('btn-boss');
    if (shieldBtn) {
        shieldBtn.addEventListener('click', () => {
            activatePanel('boss');
        });
    }
}

// ── Global helpers (called from HTML onclick) ─────────────────────────
window.ecoZoom = (lat, lng, label) => {
    MapMod.zoomTo(lat, lng, 14, label);
    toast(`Zoomed to ${label}`, 'info');
};

window.ecoQuickLoc = (lat, lon, label) => {
    const latI = document.getElementById('input-lat');
    const lonI = document.getElementById('input-lon');
    const prjI = document.getElementById('input-project');
    if (latI) latI.value = lat;
    if (lonI) lonI.value = lon;
    if (prjI && !prjI.value) prjI.value = label;
    MapMod.zoomTo(lat, lon, 13, label);
    toast(`Location set: ${label}`, 'success');
};

window.ecoDownloadReport = (id) => {
    if (!id || id.startsWith('mock')) {
        toast('PDF not available for this entry (no DB).', 'warning');
        return;
    }
    window.open(`/api/analysis/${id}/report`, '_blank');
};

// Opens satellite comparison for a report row — switches to Analysis panel
window.ecoViewSatCompare = (lat, lon, label) => {
    // Read the current year range from the form
    const y1 = parseInt(document.getElementById('input-y1')?.value) || 2022;
    const y2 = parseInt(document.getElementById('input-y2')?.value) || 2024;
    // Fill in coordinates so comparison is linked to this location
    const latI = document.getElementById('input-lat');
    const lonI = document.getElementById('input-lon');
    if (latI) latI.value = lat;
    if (lonI) lonI.value = lon;
    // Zoom map to location
    MapMod.zoomTo(lat, lon, 13, label);
    // Switch to Analysis panel and make result visible
    activatePanel('analysis');
    const result = document.getElementById('analysis-result');
    if (result) result.classList.add('visible');
    // Trigger comparison
    currentCompareCoords = { lat, lon };
    initSatelliteComparison(lat, lon, y1, y2);
    // Scroll the comparison widget into view
    setTimeout(() => {
        const wrap = document.getElementById('sat-compare-wrap');
        if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
    toast(`🛰 Showing satellite comparison for ${label}`, 'info');
};


// ── Toast System ──────────────────────────────────────────────────────
const ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

export function toast(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
    <span class="toast-icon">${ICONS[type] || 'ℹ️'}</span>
    <span class="toast-msg">${escHtml(msg)}</span>
    <span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;
    container.appendChild(el);

    setTimeout(() => {
        el.style.animation = 'toast-out 0.3s ease forwards';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

// ── Utilities ─────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emptyState(icon, msg) {
    return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
}

function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function formatTimeAgo(iso) {
    if (!iso) return 'Unknown';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}
