import axios from 'axios';
import { SorobanClient, CommitmentStatus } from '../soroban/client';

export interface CommitmentMetadata {
  id: number;
  dueAt: number;
  terms: string;
  apiEndpoint?: string;
  apiType?: 'pingdom' | 'uptime' | 'custom';
  threshold?: number;
  metric?: 'uptime' | 'response_time' | 'custom';
}

export interface ApiPollResult {
  success: boolean;
  value?: number;
  error?: string;
}

export class OracleWorker {
  private sorobanClient: SorobanClient;
  private pollIntervalMs: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(
    sorobanClient: SorobanClient,
    pollIntervalMs: number = 60000, // Default 1 minute
    maxRetries: number = 3,
    retryDelayMs: number = 5000, // Default 5 seconds
  ) {
    this.sorobanClient = sorobanClient;
    this.pollIntervalMs = pollIntervalMs;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
  }

  /**
   * Start the oracle worker to poll commitments and submit attestations
   */
  async start(commitments: CommitmentMetadata[]): Promise<void> {
    console.log('Starting Oracle Worker...');
    console.log(`Monitoring ${commitments.length} commitments`);

    // Process each commitment
    for (const commitment of commitments) {
      this.monitorCommitment(commitment);
    }
  }

  /**
   * Monitor a single commitment and attest when due
   */
  private async monitorCommitment(commitment: CommitmentMetadata): Promise<void> {
    const checkDue = async () => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const timeUntilDue = commitment.dueAt - now;

        if (timeUntilDue <= 0) {
          // Commitment is due, check SLA and attest
          console.log(`Commitment ${commitment.id} is due. Checking SLA...`);

          const result = await this.checkSlaWithRetry(commitment);

          let outcome: CommitmentStatus;
          if (result.success) {
            outcome = CommitmentStatus.Fulfilled;
            console.log(`Commitment ${commitment.id} SLA met. Attesting as Fulfilled.`);
          } else {
            outcome = CommitmentStatus.Breached;
            console.log(
              `Commitment ${commitment.id} SLA failed. Attesting as Breached. Error: ${result.error}`,
            );
          }

          await this.attestWithRetry(commitment.id, outcome);
        } else {
          // Not due yet, log and reschedule
          console.log(
            `Commitment ${commitment.id} not due yet. ${timeUntilDue} seconds remaining.`,
          );
          setTimeout(checkDue, Math.min(this.pollIntervalMs, timeUntilDue * 1000));
        }
      } catch (error) {
        console.error(`Error monitoring commitment ${commitment.id}:`, error);
        // Retry after delay even on error
        setTimeout(checkDue, this.pollIntervalMs);
      }
    };

    // Start monitoring
    checkDue();
  }

  /**
   * Check SLA with retry logic for API failures
   */
  private async checkSlaWithRetry(commitment: CommitmentMetadata): Promise<ApiPollResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.checkSla(commitment);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.warn(
          `SLA check attempt ${attempt}/${this.maxRetries} failed for commitment ${commitment.id}: ${lastError}`,
        );

        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs * attempt); // Exponential backoff
        }
      }
    }

    return {
      success: false,
      error: `SLA check failed after ${this.maxRetries} attempts. Last error: ${lastError}`,
    };
  }

  /**
   * Check SLA by querying external API
   */
  private async checkSla(commitment: CommitmentMetadata): Promise<ApiPollResult> {
    // Mock implementation for demonstration
    // In production, this would query actual monitoring APIs like Pingdom, UptimeRobot, etc.

    if (!commitment.apiEndpoint) {
      // If no API endpoint, use mock data based on commitment ID
      // This simulates a real API response
      const mockUptime = this.getMockUptime(commitment.id);
      const threshold = commitment.threshold || 99;

      if (mockUptime >= threshold) {
        return { success: true, value: mockUptime };
      } else {
        return {
          success: false,
          value: mockUptime,
          error: `Uptime ${mockUptime}% below threshold ${threshold}%`,
        };
      }
    }

    // Real API call implementation (example for Pingdom-like API)
    try {
      const response = await axios.get(commitment.apiEndpoint, {
        timeout: 10000,
        headers: {
          Accept: 'application/json',
          // Add API key header if needed
          // 'Authorization': `Bearer ${process.env.MONITORING_API_KEY}`
        },
      });

      // Parse response based on API type
      switch (commitment.apiType) {
        case 'pingdom':
          return this.parsePingdomResponse(response.data, commitment);
        case 'uptime':
          return this.parseUptimeResponse(response.data, commitment);
        case 'custom':
          return this.parseCustomResponse(response.data, commitment);
        default:
          return this.parseCustomResponse(response.data, commitment);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`API request failed: ${error.message} (Status: ${error.response?.status})`);
      }
      throw error;
    }
  }

  /**
   * Parse Pingdom-like API response
   */
  private parsePingdomResponse(data: any, commitment: CommitmentMetadata): ApiPollResult {
    const uptime = data.summary?.uptime || 0;
    const threshold = commitment.threshold || 99;

    if (uptime >= threshold) {
      return { success: true, value: uptime };
    } else {
      return {
        success: false,
        value: uptime,
        error: `Uptime ${uptime}% below threshold ${threshold}%`,
      };
    }
  }

  /**
   * Parse UptimeRobot-like API response
   */
  private parseUptimeResponse(data: any, commitment: CommitmentMetadata): ApiPollResult {
    const monitors = data.monitors || [];
    if (monitors.length === 0) {
      return { success: false, error: 'No monitors found in response' };
    }

    const monitor = monitors[0];
    const uptime = parseFloat(monitor.custom_uptime_ratio) || 0;
    const threshold = commitment.threshold || 99;

    if (uptime >= threshold) {
      return { success: true, value: uptime };
    } else {
      return {
        success: false,
        value: uptime,
        error: `Uptime ${uptime}% below threshold ${threshold}%`,
      };
    }
  }

  /**
   * Parse custom API response
   */
  private parseCustomResponse(data: any, commitment: CommitmentMetadata): ApiPollResult {
    // Generic parser - expects { success: boolean, value?: number, error?: string }
    if (data.success !== undefined) {
      return {
        success: data.success,
        value: data.value,
        error: data.error,
      };
    }

    // Fallback: look for common field names
    const value = data.uptime || data.availability || data.percentage || data.value;
    if (value !== undefined) {
      const threshold = commitment.threshold || 99;
      const numericValue = parseFloat(value);

      if (numericValue >= threshold) {
        return { success: true, value: numericValue };
      } else {
        return {
          success: false,
          value: numericValue,
          error: `Value ${numericValue}% below threshold ${threshold}%`,
        };
      }
    }

    return { success: false, error: 'Unable to parse custom API response' };
  }

  /**
   * Attest to commitment with retry logic
   */
  private async attestWithRetry(commitmentId: number, outcome: CommitmentStatus): Promise<string> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const txHash = await this.sorobanClient.attestCommitment(commitmentId, outcome);
        console.log(
          `Successfully attested commitment ${commitmentId} with outcome ${outcome}. TX: ${txHash}`,
        );
        return txHash;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.warn(
          `Attestation attempt ${attempt}/${this.maxRetries} failed for commitment ${commitmentId}: ${lastError}`,
        );

        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs * attempt); // Exponential backoff
        }
      }
    }

    throw new Error(
      `Attestation failed after ${this.maxRetries} attempts. Last error: ${lastError}`,
    );
  }

  /**
   * Mock uptime for testing purposes
   * In production, this would be replaced with actual API calls
   */
  private getMockUptime(commitmentId: number): number {
    // Deterministic mock based on commitment ID
    // Even IDs = good uptime (99.5%), Odd IDs = bad uptime (95%)
    return commitmentId % 2 === 0 ? 99.5 : 95.0;
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Stop the oracle worker
   */
  stop(): void {
    console.log('Oracle Worker stopped');
  }
}

/**
 * Factory function to create and start an oracle worker
 */
export async function createOracleWorker(
  sorobanClient: SorobanClient,
  commitments: CommitmentMetadata[],
  options?: {
    pollIntervalMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  },
): Promise<OracleWorker> {
  const worker = new OracleWorker(
    sorobanClient,
    options?.pollIntervalMs,
    options?.maxRetries,
    options?.retryDelayMs,
  );

  await worker.start(commitments);
  return worker;
}
