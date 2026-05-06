import { Queue } from 'bullmq';
import { createRedisConnection } from './redis-connection';
import { config } from '../config';
import { PaymentJobData } from '../types/payment';

export { createRedisConnection } from './redis-connection';
export const PAYMENT_QUEUE_NAME = 'payment-processing';

let _queue: Queue<PaymentJobData> | null = null;

function getPaymentQueue(): Queue<PaymentJobData> {
  if (!_queue) {
    _queue = new Queue<PaymentJobData>(PAYMENT_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
    });
  }
  return _queue;
}

export async function enqueuePayment(paymentId: string): Promise<void> {
  await getPaymentQueue().add(
    'process-payment',
    { payment_id: paymentId, attempt: 1 },
    {
      jobId: paymentId, 
      attempts: config.payment.maxRetries,
      backoff: { type: 'exponential', delay: config.payment.retryDelayBaseMs },
    }
  );
}
