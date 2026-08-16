import { 
  insertTrustScoreSnapshot, 
  insertCommitmentOutcome,
  snapshotNetworkDailyStats 
} from './timescaleSnapshot';
import { refreshMaterializedViews } from '../db/timescale';

const SNAPSHOT_INTERVAL = parseInt(process.env.ANALYTICS_SNAPSHOT_INTERVAL_MS || '3600000');
const VIEW_REFRESH_INTERVAL = parseInt(process.env.MATERIALIZED_VIEW_REFRESH_INTERVAL_MS || '300000');

export class AnalyticsWorker {
  private snapshotTimer: NodeJS.Timeout | null = null;
  private viewRefreshTimer: NodeJS.Timeout | null = null;

  start() {
    console.log('[Analytics Worker] Starting analytics worker...');
    
    // Schedule periodic snapshots
    this.snapshotTimer = setInterval(() => {
      this.runSnapshot();
    }, SNAPSHOT_INTERVAL);

    // Schedule periodic materialized view refreshes
    this.viewRefreshTimer = setInterval(() => {
      this.refreshViews();
    }, VIEW_REFRESH_INTERVAL);

    // Run initial snapshot and refresh
    this.runSnapshot().catch(console.error);
    this.refreshViews().catch(console.error);

    console.log('[Analytics Worker] Analytics worker started');
    console.log(`[Analytics Worker] Snapshot interval: ${SNAPSHOT_INTERVAL}ms`);
    console.log(`[Analytics Worker] View refresh interval: ${VIEW_REFRESH_INTERVAL}ms`);
  }

  stop() {
    console.log('[Analytics Worker] Stopping analytics worker...');
    
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    if (this.viewRefreshTimer) {
      clearInterval(this.viewRefreshTimer);
      this.viewRefreshTimer = null;
    }

    console.log('[Analytics Worker] Analytics worker stopped');
  }

  private async runSnapshot() {
    console.log('[Analytics Worker] Running snapshot...');
    try {
      await snapshotNetworkDailyStats();
      console.log('[Analytics Worker] Daily stats snapshot completed');
    } catch (error) {
      console.error('[Analytics Worker] Snapshot failed:', error);
    }
  }

  private async refreshViews() {
    console.log('[Analytics Worker] Refreshing materialized views...');
    try {
      await refreshMaterializedViews();
      console.log('[Analytics Worker] Materialized views refreshed');
    } catch (error) {
      console.error('[Analytics Worker] View refresh failed:', error);
    }
  }
}

// Export singleton instance
export const analyticsWorker = new AnalyticsWorker();

// Auto-start if this file is run directly
if (require.main === module) {
  analyticsWorker.start();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[Analytics Worker] Received SIGINT, shutting down...');
    analyticsWorker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[Analytics Worker] Received SIGTERM, shutting down...');
    analyticsWorker.stop();
    process.exit(0);
  });
}
