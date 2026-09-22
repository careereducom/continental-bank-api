const logger = require('../config/logger');

/**
 * Professional Audit Service for PhD Banking Project
 * This service records sensitive operations for compliance and forensic analysis.
 */
const AuditService = {
  async logAction(userId, action, details, status = 'SUCCESS', ip = 'unknown') {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      userId,
      action,
      details,
      status,
      ip,
      severity: status === 'FAILED' ? 'HIGH' : 'LOW'
    };

    // In a real bank, this would go to a separate secure 'Audit' database table
    // For this project, we write to the high-integrity winston logger
    logger.info({
      event: 'AUDIT_LOG',
      ...auditEntry
    });

    return auditEntry;
  }
};

module.exports = AuditService;
