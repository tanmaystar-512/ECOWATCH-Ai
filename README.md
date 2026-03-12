# EcoWatch Backend API

Node.js Express server for satellite image analysis and environmental change detection.

## Overview

The backend provides RESTful API endpoints for analyzing satellite imagery, storing analysis results, and retrieving historical data. It integrates with Python scripts for advanced image analysis and connects to MongoDB for data persistence.

## Features

- RESTful API for satellite image analysis
- MongoDB integration for data persistence
- Python script integration for NDVI/SSIM calculations
- Historical analysis tracking
- Error handling and validation

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Python (v3.8 or higher) - for analysis scripts
- MongoDB (local or Atlas URI)

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Python Dependencies

```bash
pip install -r requirements.txt
```

Or with a virtual environment:

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Environment Variables

Create a `.env` file in the backend directory:

```env
MONGO_URI=mongodb://localhost:27017/ecowatch
PORT=5000
NODE_ENV=development
```

For MongoDB Atlas cloud hosting:

```env
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/ecowatch?retryWrites=true&w=majority
PORT=5000
NODE_ENV=production
```

## Project Structure

```
backend/
├── models/
│   └── Analysis.js          # MongoDB schema for analysis results
├── python/
│   ├── analyze.py           # Core analysis functions (NDVI, SSIM)
│   ├── generate_report.py   # Report generation utilities
│   └── report_generator.py  # Alternative report generation
├── server.js                # Express app configuration
├── package.json             # Node.js dependencies
├── requirements.txt         # Python dependencies
└── .env                     # Environment variables (not committed)
```

## Running the Server

### Start Development Server

```bash
npm start
```

Server runs on `http://localhost:5000` by default.

### Start with Nodemon (Auto-reload)

```bash
npm run dev
```

## API Endpoints

### POST `/api/analysis/compare`

Analyze and compare satellite imagery for environmental changes.

**Request:**
```json
{
  "projectName": "Amazon Forest Study",
  "latitude": -3.4653,
  "longitude": -62.2159,
  "years": [2020, 2024]
}
```

**Response:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "projectName": "Amazon Forest Study",
  "location": {
    "latitude": -3.4653,
    "longitude": -62.2159
  },
  "analysis": {
    "ndvi": 0.68,
    "ssim": 0.87,
    "vegetationChange": 0.12
  },
  "timestamp": "2024-03-13T10:30:00Z"
}
```

**Status Codes:**
- `200` - Analysis completed successfully
- `400` - Invalid request parameters
- `500` - Server error

### GET `/api/analysis/history`

Retrieve all analysis records.

**Query Parameters:**
- `projectName` (optional) - Filter by project name
- `limit` (optional, default: 50) - Number of results
- `skip` (optional, default: 0) - Pagination offset

**Response:**
```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "projectName": "Amazon Forest Study",
    "location": {...},
    "analysis": {...},
    "timestamp": "2024-03-13T10:30:00Z"
  },
  {
    "_id": "507f191e71fbce9b3c36e0ff",
    "projectName": "Coral Reef Monitoring",
    "location": {...},
    "analysis": {...},
    "timestamp": "2024-03-13T09:15:00Z"
  }
]
```

### GET `/api/analysis/:id`

Get a specific analysis record by ID.

**Response:** Single analysis object (see history endpoint)

### DELETE `/api/analysis/:id`

Delete an analysis record.

**Response:**
```json
{
  "message": "Analysis deleted successfully",
  "deletedId": "507f1f77bcf86cd799439011"
}
```

## Database Schema

### Analysis Model

```javascript
{
  _id: ObjectId,
  projectName: String,
  location: {
    latitude: Number,
    longitude: Number
  },
  analysis: {
    ndvi: Number,           // Vegetation index (-1 to 1)
    ssim: Number,           // Structural similarity (0 to 1)
    vegetationChange: Number
  },
  timestamp: Date,
  metadata: Object          // Optional additional data
}
```

## Python Analysis Scripts

### analyze.py

Core analysis functions for satellite imagery processing.

**Functions:**
- `calculate_ndvi()` - Normalized Difference Vegetation Index
- `calculate_ssim()` - Structural Similarity Index
- `compare_images()` - Compare two satellite images

**Note**: Current implementation uses mock data. To enable real satellite data:
1. Deploy to cloud environment with access to Sentinel Hub or Google Earth Engine
2. Configure API credentials
3. Implement remote sensing algorithms

### generate_report.py & report_generator.py

Generate analysis reports in various formats (PDF, CSV, JSON).

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/ecowatch` |
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment mode | `development` |

## Error Handling

The API returns standardized error responses:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2024-03-13T10:30:00Z"
}
```

## Development

### Code Style

- Use ES6+ syntax
- Follow Node.js best practices
- Implement proper error handling
- Add comments for complex logic

### Testing

Run tests with:

```bash
npm test
```

### Debugging

Enable debug mode:

```bash
DEBUG=* npm start
```

## Deployment

### Using Docker (optional)

Create a `Dockerfile`:

```dockerfile
FROM node:16
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t ecowatch-backend .
docker run -p 5000:5000 --env-file .env ecowatch-backend
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS
- [ ] Configure CORS properly
- [ ] Set up rate limiting
- [ ] Enable database backups
- [ ] Implement logging
- [ ] Set up monitoring/alerts
- [ ] Use strong MongoDB credentials

## Troubleshooting

### MongoDB Connection Error

```
MongoNetworkError: failed to connect to server
```

**Solutions:**
- Verify MongoDB is running: `mongod`
- Check `MONGO_URI` environment variable
- Ensure MongoDB is accessible from your network
- Check credentials if using Atlas

### Port Already In Use

```bash
# Find process on port 5000
netstat -ano | findstr :5000

# Kill process (Windows)
taskkill /PID <PID> /F
```

### Python Analysis Timeout

- Increase timeout in `server.js`
- Verify Python environment is properly activated
- Check Python dependencies are installed

## Performance Optimization

- Implement caching for repeated queries
- Use database indexing on `projectName` and `timestamp`
- Implement pagination for large datasets
- Consider async processing for heavy analysis

## Security

- Validate and sanitize all user inputs
- Implement rate limiting on endpoints
- Use HTTPS in production
- Store sensitive data in environment variables
- Implement proper authentication (JWT recommended)
- Keep dependencies updated

## Support & Contributing

For issues or contributions, please:
1. Create a detailed issue report
2. Fork the repository
3. Create a feature branch
4. Submit a pull request

## License

MIT License
