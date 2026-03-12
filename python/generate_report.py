#!/usr/bin/env python
"""
Wrapper script for Node.js to generate PDF reports.
Called as: python generate_report.py projectName coordinates years ndvi_change ssim_score alert_level
"""
import sys
import json
import os
from report_generator import generate_audit_report

def main():
    if len(sys.argv) < 7:
        print(json.dumps({'error': 'usage: generate_report.py projectName coordinates years ndvi_change ssim_score alert_level'}))
        return
    
    try:
        projectName = sys.argv[1]
        coords = json.loads(sys.argv[2])
        years = json.loads(sys.argv[3])
        ndvi_change = float(sys.argv[4])
        ssim_score = None if sys.argv[5] == 'null' else float(sys.argv[5])
        alert_level = sys.argv[6]
        
        pdf_path = generate_audit_report(
            projectName=projectName,
            coords=coords,
            years=years,
            ndvi_change=ndvi_change,
            ssim_score=ssim_score,
            alert_level=alert_level
        )
        
        print(json.dumps({
            'success': True,
            'pdf_path': pdf_path
        }))
    except Exception as e:
        print(json.dumps({
            'error': str(e)
        }))

if __name__ == '__main__':
    main()
