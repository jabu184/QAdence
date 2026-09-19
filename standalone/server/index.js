const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./db');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api', apiRouter);

// Serve client in production if built
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(clientDist, 'index.html'), err => {
      if (err) res.status(404).send('Patient QA Analytics Server is running. Client frontend not built yet.');
    });
  }
  next();
});

app.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`Patient QA Analytics Server running locally on http://${HOST}:${PORT} (Offline / Localhost Only)`);
  console.log(`API Status: http://${HOST}:${PORT}/api/status`);
  console.log(`====================================================`);
});
