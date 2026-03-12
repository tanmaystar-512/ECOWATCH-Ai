#!/usr/bin/env python
"""
EcoWatch AI Engine - Satellite NDVI Analysis
No scikit-image dependency — pure numpy implementation to avoid OpenBLAS crashes.
Priority: GEE → Sentinel Hub → Mock fallback
"""
import os
# Fix OpenBLAS multi-threading crash on Windows
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['NUMEXPR_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'

import sys
import json
import numpy as np
from datetime import datetime

# Load .env from backend root
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
except Exception:
    pass


# ── Pure-numpy SSIM (no scikit-image needed) ─────────────────────────────────
def compute_ssim_numpy(img1, img2):
    """Structural Similarity Index — pure numpy, no OpenBLAS issues."""
    C1 = (0.01 * 1.0) ** 2
    C2 = (0.03 * 1.0) ** 2

    img1 = img1.astype(float)
    img2 = img2.astype(float)

    mu1 = np.mean(img1)
    mu2 = np.mean(img2)
    mu1_sq = mu1 ** 2
    mu2_sq = mu2 ** 2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = np.var(img1)
    sigma2_sq = np.var(img2)
    sigma12 = np.mean((img1 - mu1) * (img2 - mu2))

    ssim_val = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / \
               ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))
    return float(ssim_val)


def compute_alert(ndvi_change, ssim_score):
    if ssim_score is None:
        ssim_score = 1.0
    if ssim_score < 0.7 or ndvi_change < -0.2:
        return 'HIGH'
    if ssim_score < 0.85 or ndvi_change < -0.1:
        return 'MEDIUM'
    return 'LOW'


# ── GEE Fetch ────────────────────────────────────────────────────────────────
def get_ndvi_with_gee(bbox, years):
    try:
        import ee
    except ImportError:
        return None, 'earthengine-api not installed'

    gee_project = os.getenv('GEE_PROJECT', '')
    try:
        if gee_project:
            ee.Initialize(project=gee_project)
        else:
            ee.Initialize()
    except Exception as e:
        return None, f'GEE init failed: {e}'

    lon_min, lat_min, lon_max, lat_max = bbox
    region = ee.Geometry.Rectangle([lon_min, lat_min, lon_max, lat_max])

    def mask_s2(image):
        qa = image.select('QA60')
        mask = qa.bitwiseAnd(1 << 10).eq(0).And(qa.bitwiseAnd(1 << 11).eq(0))
        return image.updateMask(mask).divide(10000)

    ndvi_arrays = {}
    for year in years:
        try:
            col = (ee.ImageCollection('COPERNICUS/S2_SR')
                   .filterBounds(region)
                   .filterDate(f'{year}-06-01', f'{year}-09-30')
                   .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
                   .map(mask_s2))
            if col.size().getInfo() == 0:
                return None, f'No images for year {year}'
            ndvi = col.median().normalizedDifference(['B8', 'B4']).rename('NDVI')
            info = ndvi.sampleRectangle(region=region, defaultValue=-9999).getInfo()
            props = info.get('properties', {})
            data = props.get('NDVI')
            if data is None:
                return None, f'No NDVI data for {year}'
            ndvi_arrays[year] = np.array(data, dtype=float)
        except Exception as e:
            return None, f'GEE error year {year}: {e}'

    return ndvi_arrays, None


# ── Sentinel Hub Fetch ───────────────────────────────────────────────────────
def get_ndvi_with_sentinelhub(bbox, years):
    try:
        from sentinelhub import SHConfig, SentinelHubRequest, MimeType, CRS, BBox, DataCollection
    except ImportError:
        return None, 'sentinelhub not installed'

    client_id     = os.getenv('SENTINELHUB_CLIENT_ID', '')
    client_secret = os.getenv('SENTINELHUB_CLIENT_SECRET', '')
    if not client_id or not client_secret:
        return None, 'SENTINELHUB credentials not set in .env'

    try:
        config = SHConfig()
        config.sh_client_id     = client_id
        config.sh_client_secret = client_secret
    except Exception as e:
        return None, f'SH config error: {e}'

    bbox_obj = BBox(bbox=bbox, crs=CRS.WGS84)
    evalscript = """
//VERSION=3
function setup(){return{input:[{bands:['B04','B08','dataMask']}],output:{bands:1,sampleType:'FLOAT32'}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[-9999];
  return[(s.B08-s.B04)/(s.B08+s.B04+0.0001)];
}
"""
    ndvi_arrays = {}
    for year in years:
        try:
            req = SentinelHubRequest(
                evalscript=evalscript,
                input_data=[SentinelHubRequest.input_data(
                    data_collection=DataCollection.SENTINEL2_L2A,
                    time_interval=(f'{year}-06-01', f'{year}-09-30'),
                    mosaicking_order='leastCC'
                )],
                responses=[SentinelHubRequest.output_response('default', MimeType.TIFF)],
                bbox=bbox_obj, size=(64, 64), config=config
            )
            data = req.get_data()[0]
            arr = np.array(data[:, :, 0] if data.ndim == 3 else data, dtype=float)
            arr[arr == -9999] = np.nan
            ndvi_arrays[year] = arr
        except Exception as e:
            return None, f'SH error year {year}: {e}'

    return ndvi_arrays, None


# ── Realistic mock (seeded by lat/lon) ───────────────────────────────────────
def get_mock_ndvi(years, lat, lon):
    ndvi_arrays = {}
    seed_base = int((abs(lat) * 1000 + abs(lon) * 1000)) % (2**31)
    for i, year in enumerate(years):
        rng = np.random.RandomState((seed_base + year) % (2**31))
        base = 0.55 - i * 0.07            # simulate gradual vegetation loss
        arr  = rng.normal(loc=base, scale=0.10, size=(32, 32))
        ndvi_arrays[year] = np.clip(arr, 0.0, 0.9)
    return ndvi_arrays


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 5:
        print(json.dumps({'error': 'usage: analyze.py projectName lat lon years_json'}))
        sys.exit(1)

    project_name = sys.argv[1]
    lat   = float(sys.argv[2])
    lon   = float(sys.argv[3])
    years = json.loads(sys.argv[4])

    if len(years) < 2:
        print(json.dumps({'error': 'Need at least 2 years'}))
        sys.exit(1)

    bbox  = (lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05)
    notes = []

    # 1 — GEE
    ndvi_arrays, err = get_ndvi_with_gee(bbox, years)
    if err or ndvi_arrays is None:
        notes.append(f'GEE: {err}')
        # 2 — Sentinel Hub
        ndvi_arrays, err2 = get_ndvi_with_sentinelhub(bbox, years)
        if err2 or ndvi_arrays is None:
            notes.append(f'SentinelHub: {err2}')
            # 3 — mock
            ndvi_arrays = get_mock_ndvi(years, lat, lon)
            notes.append('Using realistic mock NDVI (configure API keys in .env for live data)')
        else:
            notes.append('Data: Sentinel Hub')
    else:
        notes.append('Data: Google Earth Engine')

    y1, y2 = years[0], years[1]
    arr1   = ndvi_arrays[y1]
    arr2   = ndvi_arrays[y2]

    # Match shapes
    if arr1.shape != arr2.shape:
        r = min(arr1.shape[0], arr2.shape[0])
        c = min(arr1.shape[1], arr2.shape[1])
        arr1, arr2 = arr1[:r, :c], arr2[:r, :c]

    # Fill NaN
    for a in [arr1, arr2]:
        m = np.nanmean(a)
        if np.isnan(m):
            m = 0.3
        a[np.isnan(a)] = m

    mean1       = float(np.mean(arr1))
    mean2       = float(np.mean(arr2))
    ndvi_change = round(mean2 - mean1, 4)

    try:
        ssim_score = round(compute_ssim_numpy(arr1, arr2), 4)
    except Exception as e:
        ssim_score = None
        notes.append(f'SSIM error: {e}')

    alert_level = compute_alert(ndvi_change, ssim_score)

    result = {
        'projectName':  project_name,
        'coordinates':  {'lat': lat, 'lon': lon, 'bbox': list(bbox)},
        'years_compared': [y1, y2],
        'ndvi_year1':   round(mean1, 4),
        'ndvi_year2':   round(mean2, 4),
        'ndvi_change':  ndvi_change,
        'ssim_score':   ssim_score,
        'alert_level':  alert_level,
        'timestamp':    datetime.utcnow().isoformat() + 'Z',
        'notes':        notes
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
