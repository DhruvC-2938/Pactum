import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger/logger';

/**
 * Express middleware to automatically log all incoming HTTP requests,
 * capturing method, path, response times, and HTTP status codes.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = performance.now();

  res.on('finish', () => {
    const durationMs = Number((performance.now() - startTime).toFixed(2));
    const statusCode = res.statusCode;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    const logData = {
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode,
      durationMs,
      clientIp,
      userAgent: req.get('user-agent') || 'unknown',
    };

    if (statusCode >= 500) {
      logger.error(
        `HTTP ${req.method} ${req.path} -> ${statusCode} (${durationMs}ms)`,
        undefined,
        logData,
      );
    } else if (statusCode >= 400) {
      logger.warn(`HTTP ${req.method} ${req.path} -> ${statusCode} (${durationMs}ms)`, logData);
    } else {
      logger.info(`HTTP ${req.method} ${req.path} -> ${statusCode} (${durationMs}ms)`, logData);
    }
  });

  next();
}
