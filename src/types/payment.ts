export type PaymentStatus = 'pending' | 'processing' | 'success' | 'failed';

export interface Payment {
  id: string;
  idempotency_key: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  gateway_transaction_id: string | null;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePaymentDTO {
  idempotency_key: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayResponse {
  success: boolean;
  transaction_id?: string;
  error?: string;
  retriable: boolean;
}

export interface WebhookPayload {
  transaction_id: string;
  status: 'success' | 'failed';
  error?: string;
  timestamp: string;
}

export interface PaymentJobData {
  payment_id: string;
  attempt: number;
}
