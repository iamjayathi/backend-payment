import { db } from './client';
import { Payment, PaymentStatus, CreatePaymentDTO, WebhookPayload } from '../types/payment';
import { config } from '../config';
import { v4 as uuid } from 'uuid';

export class PaymentRepository {

  async create(dto: CreatePaymentDTO): Promise<Payment> {
    const { rows } = await db.query<Payment>(
      `INSERT INTO payments
        (id, idempotency_key, amount, currency, metadata, max_retries)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        uuid(),
        dto.idempotency_key,
        dto.amount,
        dto.currency || 'USD',
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        config.payment.maxRetries,
      ]
    );

    return rows[0];
  }


  async findById(id: string): Promise<Payment | null> {
    const { rows } = await db.query<Payment>(
      'SELECT * FROM payments WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    const { rows } = await db.query<Payment>(
      'SELECT * FROM payments WHERE idempotency_key = $1',
      [key]
    );
    return rows[0] || null;
  }

  async findByGatewayTransactionId(txId: string): Promise<Payment | null> {
    const { rows } = await db.query<Payment>(
      'SELECT * FROM payments WHERE gateway_transaction_id = $1',
      [txId]
    );
    return rows[0] || null;
  }

  async saveWebhookEvent(payload: WebhookPayload): Promise<void> {
    await db.query(
      `INSERT INTO webhook_events
        (id, transaction_id, payment_id, status, error_message, received_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (transaction_id) DO UPDATE
       SET
         payment_id = COALESCE(webhook_events.payment_id, EXCLUDED.payment_id),
         error_message = COALESCE(webhook_events.error_message, EXCLUDED.error_message)`,
      [
        uuid(),
        payload.transaction_id,
        payload.payment_id || null,
        payload.status,
        payload.error || null,
        payload.timestamp,
      ]
    );
  }

  async updateStatus(
    id: string,
    from: PaymentStatus,
    to: PaymentStatus,
    extra: {
      gateway_transaction_id?: string;
      error_message?: string;
      retry_count?: number;
      increment_retry_count?: boolean;
    } = {}
  ): Promise<Payment | null> {
    const { rows } = await db.query<Payment>(
      `UPDATE payments
       SET
         status = $3,
         gateway_transaction_id = COALESCE($4, gateway_transaction_id),
         error_message = COALESCE($5, error_message),
         retry_count = CASE
           WHEN $7 THEN retry_count + 1
           ELSE COALESCE($6, retry_count)
         END
       WHERE id = $1 AND status = $2
       RETURNING *`,
      [
        id,
        from,
        to,
        extra.gateway_transaction_id,
        extra.error_message,
        extra.retry_count,
        Boolean(extra.increment_retry_count),
      ]
    );

    return rows[0] || null;
  }

  async updateByGatewayTx(
    txId: string,
    status: 'success' | 'failed',
    errorMessage?: string
  ): Promise<Payment | null> {
    const { rows } = await db.query<Payment>(
      `UPDATE payments
       SET status = $2,
           error_message = $3
       WHERE gateway_transaction_id = $1
         AND status NOT IN ('success', 'failed')
       RETURNING *`,
      [txId, status, errorMessage || null]
    );

    return rows[0] || null;
  }

  async applyWebhook(
    txId: string,
    paymentId: string | undefined,
    status: 'success' | 'failed',
    errorMessage?: string
  ): Promise<Payment | null> {
    const { rows } = await db.query<Payment>(
      `UPDATE payments
       SET status = $3,
           gateway_transaction_id = COALESCE(gateway_transaction_id, $1),
           error_message = CASE
             WHEN $3 = 'failed' THEN COALESCE($4, error_message)
             ELSE error_message
           END
       WHERE status NOT IN ('success', 'failed')
         AND (
           gateway_transaction_id = $1
           OR ($2::uuid IS NOT NULL AND id = $2::uuid)
         )
       RETURNING *`,
      [txId, paymentId || null, status, errorMessage || null]
    );

    return rows[0] || null;
  }
}

export const paymentRepository = new PaymentRepository();
