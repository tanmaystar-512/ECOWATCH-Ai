const mongoose = require('mongoose');

const AnalysisSchema = new mongoose.Schema({
  projectName: { type: String, index: true },
  coordinates: {
    lat: { type: Number },
    lon: { type: Number }
  },
  ndvi_change: { type: Number },
  ssim_score: { type: Number },
  alert_level: { type: String, enum: ['LOW','MEDIUM','HIGH'], default: 'LOW' },
  pdf_report: { type: String },
  analysis_notes: { type: [String], default: [] },
  timestamp: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('Analysis', AnalysisSchema);

