const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const Analysis = require('./models/Analysis');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Serve frontend static files
const frontendPath = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
}

// Serve generated PDF reports
const pythonDir = path.join(__dirname, 'python');
app.use('/reports', express.static(pythonDir));

// ─── MongoDB ────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
let mongoConnected = false;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 8000,
    tls: true,
  })
    .then(() => { mongoConnected = true; console.log('✅ MongoDB connected'); })
    .catch(err => console.warn('⚠️  MongoDB connection failed:', err.message));
} else {
  console.warn('⚠️  MONGO_URI not set — running in degraded mode (no persistence)');
}

// Helper: Retry logic for MongoDB operations
async function saveWithRetry(doc, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await doc.save(); }
    catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Helper: run a python script, returns a Promise<{stdout, stderr}>
function runPython(scriptPath, args = [], timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile('python', [scriptPath, ...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject({ err, stderr });
      resolve({ stdout, stderr });
    });
  });
}

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mongo: mongoConnected ? 'connected' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// ─── POST /api/analysis/compare ──────────────────────────────────────────────
app.post('/api/analysis/compare', async (req, res) => {
  try {
    const { projectName, latitude, longitude, years } = req.body;
    if (!projectName || latitude === undefined || longitude === undefined || !years || !Array.isArray(years)) {
      return res.status(400).json({ error: 'projectName, latitude, longitude, and years[] are required' });
    }
    if (years.length < 2) {
      return res.status(400).json({ error: 'Provide at least two years for comparison' });
    }

    const pythonPath = path.join(__dirname, 'python', 'analyze.py');
    const args = [projectName, String(latitude), String(longitude), JSON.stringify(years)];

    let result;
    try {
      const { stdout, stderr } = await runPython(pythonPath, args, 120000);
      if (stderr) console.warn('📌 Python stderr:', stderr.slice(0, 500));
      result = JSON.parse(stdout.trim());
    } catch (e) {
      console.error('❌ Python script error:', e.err?.message || e);
      // Return graceful degraded result with mock data flag
      result = {
        projectName,
        coordinates: { lat: latitude, lon: longitude, bbox: [longitude - 0.001, latitude - 0.001, longitude + 0.001, latitude + 0.001] },
        years_compared: [years[0], years[1]],
        ndvi_change: -0.05,
        ssim_score: 0.92,
        alert_level: 'LOW',
        timestamp: new Date().toISOString(),
        notes: ['Analysis script failed — using fallback mock result'],
        is_mock: true
      };
    }

    // Generate PDF report (synchronous, awaited)
    let pdfPath = null;
    const reportCmd = path.join(__dirname, 'python', 'generate_report.py');
    if (fs.existsSync(reportCmd)) {
      try {
        const reportArgs = [
          result.projectName || projectName,
          JSON.stringify(result.coordinates || { lat: latitude, lon: longitude, bbox: [] }),
          JSON.stringify(result.years_compared || years),
          String(result.ndvi_change ?? 0),
          result.ssim_score !== null && result.ssim_score !== undefined ? String(result.ssim_score) : 'null',
          result.alert_level || 'LOW'
        ];
        const { stdout: reportOut } = await runPython(reportCmd, reportArgs, 30000);
        const reportData = JSON.parse(reportOut.trim());
        if (reportData.pdf_path) {
          pdfPath = reportData.pdf_path;
          console.log('📄 PDF report generated:', pdfPath);
        }
      } catch (e) {
        console.warn('⚠️  PDF generation failed (non-fatal):', e.err?.message || e);
      }
    }

    // Save to MongoDB
    let savedDoc = null;
    if (mongoConnected) {
      try {
        const doc = new Analysis({
          projectName: result.projectName || projectName,
          coordinates: { lat: latitude, lon: longitude },
          ndvi_change: result.ndvi_change,
          ssim_score: result.ssim_score,
          alert_level: result.alert_level,
          pdf_report: pdfPath,
          timestamp: result.timestamp ? new Date(result.timestamp) : new Date(),
          analysis_notes: result.notes || []
        });
        savedDoc = await saveWithRetry(doc);
        console.log('💾 Analysis saved to MongoDB:', savedDoc._id);
      } catch (e) {
        console.warn('⚠️  Could not save to MongoDB:', e.message);
      }
    }

    return res.json({
      success: true,
      result,
      pdf_report: pdfPath,
      pdf_url: pdfPath ? `/reports/${path.basename(pdfPath)}` : null,
      mongodb_id: savedDoc ? savedDoc._id : null
    });

  } catch (e) {
    console.error('❌ Server error:', e);
    res.status(500).json({ error: 'Server error', details: e.message });
  }
});

// ─── GET /api/analysis/history ───────────────────────────────────────────────
app.get('/api/analysis/history', async (req, res) => {
  try {
    if (!mongoConnected) {
      return res.json({ history: getMockHistory(), count: 3, source: 'mock' });
    }
    const limit = parseInt(req.query.limit) || 100;
    const list = await Analysis.find().sort({ timestamp: -1 }).limit(limit).lean();
    res.json({ history: list, count: list.length, source: 'mongodb' });
  } catch (e) {
    console.warn('⚠️  Could not fetch history:', e.message);
    res.json({ history: getMockHistory(), count: 3, source: 'mock_fallback' });
  }
});

// ─── GET /api/analysis/by-project/:projectName ───────────────────────────────
app.get('/api/analysis/by-project/:projectName', async (req, res) => {
  try {
    if (!mongoConnected) return res.json({ projectName: req.params.projectName, analyses: [], count: 0, source: 'mock' });
    const list = await Analysis.find({ projectName: req.params.projectName }).sort({ timestamp: -1 }).lean();
    res.json({ projectName: req.params.projectName, analyses: list, count: list.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch project analyses' });
  }
});

// ─── GET /api/analysis/:id/report ────────────────────────────────────────────
app.get('/api/analysis/:id/report', async (req, res) => {
  try {
    const doc = await Analysis.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Analysis not found' });
    if (!doc.pdf_report || !fs.existsSync(doc.pdf_report)) {
      return res.status(404).json({ error: 'Report file not found' });
    }
    res.download(doc.pdf_report);
  } catch (e) {
    res.status(500).json({ error: 'Could not retrieve report' });
  }
});

// ─── GET /api/analysis/:id ────────────────────────────────────────────────────
app.get('/api/analysis/:id', async (req, res) => {
  try {
    const doc = await Analysis.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Analysis not found' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch analysis' });
  }
});

// ─── Catch-all: serve index.html for SPA ─────────────────────────────────────
if (fs.existsSync(frontendPath)) {
  app.get('*', (req, res) => {
    const indexFile = path.join(frontendPath, 'index.html');
    if (fs.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.status(404).send('Frontend not found');
    }
  });
}

// ─── Mock history helper ──────────────────────────────────────────────────────
function getMockHistory() {
  return [
    {
      _id: 'mock001',
      projectName: 'Vidhyadhar Nagar - Jaipur',
      coordinates: { lat: 26.9455, lon: 75.7820 },
      ndvi_change: -0.14,
      ssim_score: 0.78,
      alert_level: 'HIGH',
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      analysis_notes: ['Used mock arrays as final fallback'],
      pdf_report: null
    },
    {
      _id: 'mock002',
      projectName: 'Mansarovar Extension',
      coordinates: { lat: 26.8438, lon: 75.7424 },
      ndvi_change: -0.07,
      ssim_score: 0.86,
      alert_level: 'MEDIUM',
      timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      analysis_notes: ['Used mock arrays as final fallback'],
      pdf_report: null
    },
    {
      _id: 'mock003',
      projectName: 'Aravalli Ridge Survey',
      coordinates: { lat: 27.0238, lon: 76.1347 },
      ndvi_change: 0.03,
      ssim_score: 0.95,
      alert_level: 'LOW',
      timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      analysis_notes: ['Used mock arrays as final fallback'],
      pdf_report: null
    }
  ];
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌍 EcoWatch Server running at http://localhost:${PORT}`);
  console.log(`📊 API Dashboard: http://localhost:${PORT}/api/health\n`);
});
