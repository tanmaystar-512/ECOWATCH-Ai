/**
 * EcoWatch API Client
 * All backend API calls with error handling and mock fallback.
 */

const BASE = '';  // same origin

export async function getHealth() {
    const r = await fetch(`${BASE}/api/health`);
    if (!r.ok) throw new Error('Health check failed');
    return r.json();
}

export async function runAnalysis({ projectName, latitude, longitude, years }) {
    const r = await fetch(`${BASE}/api/analysis/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, latitude, longitude, years })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Analysis failed');
    return data;
}

export async function getHistory(limit = 50) {
    const r = await fetch(`${BASE}/api/analysis/history?limit=${limit}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to fetch history');
    return data;
}

export async function getAnalysis(id) {
    const r = await fetch(`${BASE}/api/analysis/${id}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Not found');
    return data;
}

export function getReportUrl(id) {
    return `${BASE}/api/analysis/${id}/report`;
}
