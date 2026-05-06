import { paymentRepository } from '../db/payment.repository';
import { enqueuePayment } from '../queue/payment.queue';
import {
  simulateGateway,
  GatewayTimeoutError,
  CircuitOpenError,
} from '../gateway/gateway.simulator';
import { CreatePaymentDTO, Payment, WebhookPayload } from '../types/payment';
import { logger } from '../logger';

export class PaymentService {

  async createPayment(dto: CreatePaymentDTO): Promise<Payment> {
    const existing = await paymentRepository.findByIdempotencyKey(
      dto.idempotency_key
    );

    if (existing) {
      logger.info('Returning existing payment (idempotent)', {
        paymentId: existing.id,
      });

      if (existing.status === 'pending') {
        await enqueuePayment(existing.id);
        logger.info('Existing pending payment re-queued', { paymentId: existing.id });
      }

      return existing;
    }

    const payment = await paymentRepository.create(dto);

    logger.info('Payment created', { paymentId: payment.id });

    try {
      await enqueuePayment(payment.id);
    } catch (err) {
      logger.error('Payment queue enqueue failed', { paymentId: payment.id, err });
      throw err;
    }

    logger.info('Payment queued', { paymentId: payment.id });

    return payment;
  }

  async getPayment(id: string): Promise<Payment | null> {
    return paymentRepository.findById(id);
  }

  async processPayment(paymentId: string): Promise<void> {
    const locked = await paymentRepository.updateStatus(
      paymentId,
      'pending',
      'processing',
      { increment_retry_count: true }
    );

    if (!locked) return;

    const payment = locked;

    logger.info('Processing payment', { paymentId });

    try {
      const result = await simulateGateway(paymentId, payment.amount);

      if (result.success) {
        await paymentRepository.updateStatus(
          paymentId,
          'processing',
          'success',
          {
            gateway_transaction_id: result.transaction_id,
          }
        );

        logger.info('Payment success', { paymentId });
        return;
      }

      if (!result.retriable) {
        await paymentRepository.updateStatus(
          paymentId,
          'processing',
          'failed',
          {
            error_message: result.error,
          }
        );

        logger.warn('Payment failed permanently', {
          paymentId,
          error: result.error,
        });

        return;
      }
      await paymentRepository.updateStatus(
        paymentId,
        'processing',
        'pending',
        {
          error_message: result.error,
        }
      );

      throw new Error(result.error || 'Retryable failure');
    } catch (err) {
      if (
        err instanceof GatewayTimeoutError ||
        err instanceof CircuitOpenError
      ) {
        await paymentRepository.updateStatus(
          paymentId,
          'processing',
          'pending',
          {
            error_message: err.message,
          }
        );

        throw err; 
      }

      throw err;
    }
  }


  async markPaymentFailed(paymentId: string, reason: string) {
    await paymentRepository.updateStatus(paymentId, 'pending', 'failed', {
      error_message: reason,
    });

    logger.error('Payment permanently failed', { paymentId, reason });
  }

  async handleWebhook(payload: WebhookPayload) {
    const { transaction_id, payment_id, status, error } = payload;

    logger.info('Webhook received', { transaction_id, payment_id, status });

    await paymentRepository.saveWebhookEvent(payload);

    const updated = await paymentRepository.applyWebhook(
      transaction_id,
      payment_id,
      status,
      error
    );

    if (!updated) {
      logger.info('Webhook stored without payment update', { transaction_id, payment_id, status });
      return;
    }

    logger.info('Webhook applied', {
      paymentId: updated.id,
      status,
    });
  }
}

export const paymentService = new PaymentService();
