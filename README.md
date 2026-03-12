# EcoWatch Prototype

This workspace contains a scaffold for the three-phase system you described:

- Phase 1: `backend/python/analyze.py` — Python analysis script scaffold (NDVI/SSIM logic, mock by default).
- Phase 2: `backend/server.js` — Node.js Express API with endpoints `POST /api/analysis/compare` and `GET /api/analysis/history`.
- Phase 3: UI work is not included here yet — this backend provides the API and MongoDB schema to integrate with a dashboard.

Important: Do not commit API keys. Use environment variables (see `.env.example`).
