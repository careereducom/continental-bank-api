// backend/src/config/logger.js
const winston = require('winston');

const transports = [new winston.transports.Console()];

// Only write log files when running locally (Netlify has a read-only filesystem)
if (!process.env.NETLIFY) {
  const fs = require('fs');
  const path = require('path');
  const logDir = path.join(__dirname, '..', '..', 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'audit.log'),
      level: 'info',
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'errors.log'),
      level: 'error',
    })
  );
}

module.exports = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports,
});