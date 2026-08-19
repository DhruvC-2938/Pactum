export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

/**
 * Enterprise-grade structured logger for Pactum Trust Layer.
 * Emits JSON in production environments and colorized structured text in development.
 */
class StructuredLogger {
  private isProduction: boolean;

  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const pid = process.pid;

    if (this.isProduction) {
      return JSON.stringify({
        timestamp,
        level: level.toUpperCase(),
        pid,
        service: 'pactum-backend',
        message,
        ...context,
      });
    }

    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[34mDEBUG\x1b[0m',
      info: '\x1b[32mINFO\x1b[0m',
      warn: '\x1b[33mWARN\x1b[0m',
      error: '\x1b[31mERROR\x1b[0m',
    };

    const colorLevel = levelColors[level] || level.toUpperCase();
    const contextStr =
      context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${colorLevel}] [pactum-backend] ${message}${contextStr}`;
  }

  public debug(message: string, context?: LogContext): void {
    if (process.env.LOG_LEVEL === 'debug' || !this.isProduction) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  public info(message: string, context?: LogContext): void {
    console.info(this.formatMessage('info', message, context));
  }

  public warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage('warn', message, context));
  }

  public error(message: string, error?: unknown, context?: LogContext): void {
    const mergedContext: LogContext = { ...context };
    if (error instanceof Error) {
      mergedContext.errorName = error.name;
      mergedContext.errorMessage = error.message;
      mergedContext.stack = error.stack;
    } else if (error) {
      mergedContext.error = error;
    }
    console.error(this.formatMessage('error', message, mergedContext));
  }
}

export const logger = new StructuredLogger();
export default logger;
