import { logger } from '../logger';

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit '${name}' is OPEN`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: State = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;

  constructor(
    private name: string,
    private options: {
      failureThreshold: number;
      successThreshold: number;
      resetTimeoutMs: number;
    }
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const canRetry =
        Date.now() - this.lastFailureTime > this.options.resetTimeoutMs;

      if (!canRetry) {
        throw new CircuitOpenError(this.name);
      }

      this.state = 'HALF_OPEN';
      this.successes = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successes++;

      if (this.successes >= this.options.successThreshold) {
        this.state = 'CLOSED';
        logger.info(`Circuit ${this.name} CLOSED`);
      }
    }
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      logger.warn(`Circuit ${this.name} OPENED`);
    }
  }

  getState() {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failures,
      lastFailureTime: this.lastFailureTime || null,
    };
  }
}

export const gatewayCircuitBreaker = new CircuitBreaker('payment-gateway', {
  failureThreshold: 5,
  successThreshold: 1,
  resetTimeoutMs: 30000,
});