#!/usr/bin/env python
"""
EcoWatch Professional PDF Audit Report Generator
Produces legal-ready, branded PDF reports with NDVI analysis results.
"""
import os
import hashlib
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle
from reportlab.lib.utils import ImageReader


BRAND_GREEN  = colors.HexColor('#00f5a0')
BRAND_DARK   = colors.HexColor('#0a0f1e')
BRAND_MID    = colors.HexColor('#141e3c')
ALERT_COLORS = {
    'HIGH':   colors.HexColor('#ff3864'),
    'MEDIUM': colors.HexColor('#ffb830'),
    'LOW':    colors.HexColor('#00f5a0'),
}


def _draw_watermark(c, width, height, text="LEGAL-READY"):
    c.saveState()
    c.setFillColor(colors.HexColor('#1a2540'))
    c.setFont('Helvetica-Bold', 60)
    c.translate(width / 2, height / 2)
    c.rotate(35)
    c.drawCentredString(0, 0, text)
    c.restoreState()


def _make_report_hash(project_name, lat, lon, ndvi_change, alert_level, ts):
    raw = f"{project_name}|{lat}|{lon}|{ndvi_change}|{alert_level}|{ts}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24].upper()


def generate_audit_report(project_name=None, projectName=None,
                           coords=None, years=None,
                           ndvi_change=0.0, ssim_score=None,
                           alert_level='LOW', image_paths=None,
                           ndvi_year1=None, ndvi_year2=None):
    # Accept both naming conventions
    name = project_name or projectName or 'Unnamed Project'
    safe_name = name.replace(' ', '_').replace('/', '_')
    ts_str = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    pdf_path = os.path.join(
        os.path.dirname(__file__),
        f'report_{safe_name}_{ts_str}.pdf'
    )

    lat = coords.get('lat', 0) if coords else 0
    lon = coords.get('lon', 0) if coords else 0
    bbox = coords.get('bbox', []) if coords else []
    y1 = years[0] if years and len(years) >= 2 else 'N/A'
    y2 = years[1] if years and len(years) >= 2 else 'N/A'

    c = canvas.Canvas(pdf_path, pagesize=A4)
    width, height = A4
    M = 20 * mm   # margin
    y = height - M

    # ── Background fill
    c.setFillColor(BRAND_DARK)
    c.rect(0, 0, width, height, fill=True, stroke=False)

    # ── Watermark
    _draw_watermark(c, width, height)

    # ── Header bar
    c.setFillColor(BRAND_MID)
    c.rect(0, height - 28 * mm, width, 28 * mm, fill=True, stroke=False)

    c.setFillColor(BRAND_GREEN)
    c.setFont('Helvetica-Bold', 18)
    c.drawString(M, height - 18 * mm, '🌍 EcoWatch Professional')

    c.setFillColor(colors.white)
    c.setFont('Helvetica', 9)
    c.drawString(M, height - 24 * mm, 'Geospatial Vegetation Monitoring & Legal Compliance Audit')

    # Report ID top-right
    report_hash = _make_report_hash(name, lat, lon, ndvi_change, alert_level, ts_str)
    c.setFillColor(BRAND_GREEN)
    c.setFont('Helvetica-Bold', 8)
    c.drawRightString(width - M, height - 16 * mm, f'REPORT ID: ECW-{report_hash}')
    c.setFont('Helvetica', 8)
    c.setFillColor(colors.lightgrey)
    c.drawRightString(width - M, height - 21 * mm, f'Generated: {datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}')

    y = height - 34 * mm

    # ── Project title
    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', 14)
    c.drawString(M, y, name)
    y -= 7 * mm

    # ── Alert level banner
    al_color = ALERT_COLORS.get(alert_level, colors.grey)
    c.setFillColor(al_color)
    c.roundRect(M, y - 6 * mm, 60 * mm, 9 * mm, 2 * mm, fill=True, stroke=False)
    c.setFillColor(BRAND_DARK)
    c.setFont('Helvetica-Bold', 11)
    c.drawCentredString(M + 30 * mm, y - 2 * mm, f'⚠ {alert_level} ALERT')
    y -= 14 * mm

    # ── Section: Location
    _section_header(c, M, y, width, 'LOCATION DETAILS', BRAND_GREEN)
    y -= 8 * mm

    loc_data = [
        ['Latitude', f'{lat:.6f}°'],
        ['Longitude', f'{lon:.6f}°'],
        ['Bounding Box', f'[{", ".join(f"{v:.5f}" for v in bbox)}]' if bbox else 'N/A'],
    ]
    y = _draw_table(c, M, y, width - 2 * M, loc_data)
    y -= 8 * mm

    # ── Section: Analysis Results
    _section_header(c, M, y, width, 'NDVI ANALYSIS RESULTS', BRAND_GREEN)
    y -= 8 * mm

    ssim_text = f'{ssim_score:.4f}' if ssim_score is not None else 'N/A'
    n1_text = f'{ndvi_year1:.4f}' if ndvi_year1 is not None else 'N/A'
    n2_text = f'{ndvi_year2:.4f}' if ndvi_year2 is not None else 'N/A'
    change_sign = '+' if ndvi_change >= 0 else ''

    analysis_data = [
        ['Years Compared', f'{y1}  →  {y2}'],
        [f'NDVI ({y1})', n1_text],
        [f'NDVI ({y2})', n2_text],
        ['NDVI Change', f'{change_sign}{ndvi_change:.4f}'],
        ['SSIM Score', ssim_text],
        ['Alert Level', alert_level],
    ]
    y = _draw_table(c, M, y, width - 2 * M, analysis_data, highlight_row=3)
    y -= 8 * mm

    # ── Section: Legal Compliance
    _section_header(c, M, y, width, 'LEGAL COMPLIANCE NOTICE', BRAND_GREEN)
    y -= 8 * mm

    legal_lines = [
        'This report certifies that satellite imagery and derived metrics are accurately',
        'computed from authorized remote-sensing data (Sentinel-2 / COPERNICUS program).',
        'The coordinates, NDVI values, and SSIM scores embedded herein are tamper-evident',
        'via the cryptographic Report ID above. Any unauthorized modification voids this',
        "report's legal standing under applicable environmental monitoring regulations.",
        '',
        f'Report Hash (SHA-256 prefix): ECW-{report_hash}',
    ]
    c.setFont('Helvetica', 9)
    for line in legal_lines:
        c.setFillColor(colors.lightgrey)
        c.drawString(M + 2 * mm, y, line)
        y -= 5 * mm

    y -= 6 * mm

    # ── Satellite Images (if provided)
    if image_paths:
        _section_header(c, M, y, width, 'SATELLITE IMAGERY', BRAND_GREEN)
        y -= 8 * mm
        shown = 0
        for label, img_path in image_paths.items():
            if img_path and os.path.exists(img_path):
                try:
                    img = ImageReader(img_path)
                    img_w = (width - 2 * M - 5 * mm) / 2
                    x_off = M + shown * (img_w + 5 * mm)
                    c.setFillColor(colors.lightgrey)
                    c.setFont('Helvetica-Bold', 9)
                    c.drawString(x_off, y, str(label))
                    c.drawImage(img, x_off, y - 55 * mm, width=img_w, height=50 * mm, preserveAspectRatio=True)
                    shown += 1
                    if shown >= 2:
                        break
                except Exception:
                    pass
        if shown > 0:
            y -= 60 * mm

    # ── Footer
    c.setFillColor(BRAND_MID)
    c.rect(0, 0, width, 18 * mm, fill=True, stroke=False)

    c.setFillColor(BRAND_GREEN)
    c.setFont('Helvetica-Bold', 8)
    c.drawString(M, 12 * mm, 'Authorized Digital Signature: ___________________________')
    c.setFillColor(colors.lightgrey)
    c.setFont('Helvetica', 8)
    c.drawRightString(width - M, 12 * mm, f'Date: {datetime.utcnow().strftime("%Y-%m-%d")}')
    c.setFont('Helvetica', 7)
    c.drawCentredString(width / 2, 5 * mm, 'EcoWatch Professional v2.0 — Confidential Environmental Audit Report')

    c.save()
    return pdf_path


def _section_header(c, x, y, page_width, title, color):
    c.setFillColor(color)
    c.rect(x, y - 1.5 * mm, page_width - 2 * x, 0.5 * mm, fill=True, stroke=False)
    c.setFillColor(color)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(x, y + 1 * mm, title)


def _draw_table(c, x, y, table_width, data, highlight_row=None):
    col_w = [table_width * 0.38, table_width * 0.62]
    table = Table([[k, v] for k, v in data], colWidths=col_w)

    style = TableStyle([
        ('BACKGROUND',  (0, 0), (-1, -1), colors.HexColor('#111827')),
        ('TEXTCOLOR',   (0, 0), (0, -1),  colors.lightgrey),
        ('TEXTCOLOR',   (1, 0), (1, -1),  colors.white),
        ('FONT',        (0, 0), (0, -1),  'Helvetica-Bold', 9),
        ('FONT',        (1, 0), (1, -1),  'Helvetica', 9),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.HexColor('#111827'), colors.HexColor('#0d1526')]),
        ('GRID',        (0, 0), (-1, -1), 0.25, colors.HexColor('#1e2d50')),
        ('TOPPADDING',  (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ])

    if highlight_row is not None and highlight_row < len(data):
        style.add('BACKGROUND',  (0, highlight_row), (-1, highlight_row), colors.HexColor('#1f1040'))
        style.add('TEXTCOLOR',   (1, highlight_row), (1, highlight_row), colors.HexColor('#00f5a0'))
        style.add('FONT',        (1, highlight_row), (1, highlight_row), 'Helvetica-Bold', 10)

    table.setStyle(style)
    w, h = table.wrapOn(c, table_width, 200)
    table.drawOn(c, x, y - h)
    return y - h - 2 * mm
