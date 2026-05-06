import { Queue } from 'bullmq';
import { createRedisConnection } from './redis-connection';
import { PaymentJobData } from '../types/payment';
import { logger } from '../logger';

export const DLQ_NAME = 'payment-dead-letter';

let _dlq: Queue<PaymentJobData & { failedReason: string }> | null = null;

function getDLQ() {
  if (!_dlq) {
    _dlq = new Queue(DLQ_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
    });
  }
  return _dlq;
}

export async function moveToDLQ(data: PaymentJobData, failedReason: string): Promise<void> {
  await getDLQ().add(
    'dead-payment',
    { ...data, failedReason },
    { jobId: `dlq_${data.payment_id}` }
  );
  logger.warn('Payment moved to dead-letter queue', {
    paymentId: data.payment_id,
    reason: failedReason,
  });
}

export async function getDLQJobs(limit = 50) {
  const jobs = await getDLQ().getJobs(['wait', 'active', 'completed'], 0, limit - 1);
  return jobs.map((job) => ({
    jobId: job.id,
    paymentId: job.data.payment_id,
    failedReason: job.data.failedReason,
    addedAt: job.timestamp,
  }));
}
