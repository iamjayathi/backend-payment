import { Worker, Job } from 'bullmq';
import { PAYMENT_QUEUE_NAME, createRedisConnection } from '../queue/payment.queue';
import { moveToDLQ } from '../queue/dlq';
import { paymentService } from '../services/payment.service';
import { PaymentJobData } from '../types/payment';
import { logger } from '../logger';
import { config } from '../config';

const worker = new Worker<PaymentJobData>(
  PAYMENT_QUEUE_NAME,
  async (job: Job<PaymentJobData>) => {
    const { payment_id } = job.data;
    logger.info('Worker: picked up payment job', {
      paymentId: payment_id,
      attempt: job.attemptsMade + 1,
      maxAttempts: config.payment.maxRetries,
    });

    await paymentService.processPayment(payment_id);
  },
  {
    connection: createRedisConnection(),
    concurrency: 5,
  }
);

worker.on('completed', (job: Job<PaymentJobData>) => {
  logger.info('Worker: job completed', { jobId: job.id, paymentId: job.data.payment_id });
});

worker.on('failed', async (job: Job<PaymentJobData> | undefined, err: Error) => {
  if (!job) return;

  const attemptsExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);

  logger.error('Worker: job failed', {
    jobId: job.id,
    paymentId: job.data.payment_id,
    attempt: job.attemptsMade,
    error: err.message,
    willRetry: !attemptsExhausted,
  });

  if (attemptsExhausted) {
    await moveToDLQ(job.data, err.message).catch((dlqErr) => {
      logger.error('Failed to move job to DLQ', { paymentId: job.data.payment_id, error: dlqErr });
    });
  }
});

worker.on('error', (err) => {
  logger.error('Worker error', { error: err });
});

logger.info('Payment worker started', { concurrency: 5, queue: PAYMENT_QUEUE_NAME });

process.on('SIGTERM', async () => {
  logger.info('Worker shutting down...');
  await worker.close();
  process.exit(0);
});
