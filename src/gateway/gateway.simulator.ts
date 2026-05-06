import { v4 as uuid } from 'uuid';
import { GatewayResponse } from '../types/payment';
import { logger } from '../logger';
import { gatewayCircuitBreaker, CircuitOpenError } from '../resilience/circuit-breaker';

export class GatewayTimeoutError extends Error {
  constructor() {
    super('Gateway timeout');
    this.name = 'GatewayTimeoutError';
  }
}

export { CircuitOpenError };

export async function simulateGateway(
  paymentId: string,
  amount: number
): Promise<GatewayResponse> {
  return gatewayCircuitBreaker.call(() =>
    callGateway(paymentId, amount)
  );
}

async function callGateway(
  paymentId: string,
  amount: number
): Promise<GatewayResponse> {
  const delayMs = random(100, 2000);
  const roll = Math.random();

  logger.info('Gateway processing', {
    paymentId,
    amount,
    delayMs: Math.round(delayMs),
  });

  await sleep(delayMs);
  if (roll < 0.15) {
    logger.warn('Gateway timeout', { paymentId });
    throw new GatewayTimeoutError();
  }

  if (roll < 0.35) {
    const error = randomFrom([
      'Insufficient funds',
      'Card declined',
      'Invalid account',
    ]);

    const retriable =
      error !== 'Insufficient funds' && error !== 'Card declined';

    logger.warn('Gateway failed', { paymentId, error });

    return { success: false, error, retriable };
  }
  const transaction_id = `txn_${uuid()}`;

  logger.info('Gateway success', { paymentId, transaction_id });

  return {
    success: true,
    transaction_id,
    retriable: false,
  };
}
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function random(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomFrom<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}