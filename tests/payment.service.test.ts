import { PaymentService } from '../src/services/payment.service';
import { paymentRepository } from '../src/db/payment.repository';
import * as queueModule from '../src/queue/payment.queue';
import * as gatewayModule from '../src/gateway/gateway.simulator';
import { Payment } from '../src/types/payment';

jest.mock('../src/db/payment.repository', () => ({
  paymentRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    findByGatewayTransactionId: jest.fn(),
    saveWebhookEvent: jest.fn(),
    updateStatus: jest.fn(),
    updateByGatewayTx: jest.fn(),
    applyWebhook: jest.fn(),
  },
}));

jest.mock('../src/queue/payment.queue', () => ({
  enqueuePayment: jest.fn(),
}));

jest.mock('../src/gateway/gateway.simulator', () => ({
  simulateGateway: jest.fn(),
  GatewayTimeoutError: class GatewayTimeoutError extends Error {
    constructor() { super('Gateway request timed out'); this.name = 'GatewayTimeoutError'; }
  },
  CircuitOpenError: class CircuitOpenError extends Error {
    constructor() { super('Circuit breaker is open'); this.name = 'CircuitOpenError'; }
  },
}));

const repo = paymentRepository as jest.Mocked<typeof paymentRepository>;
const enqueue = queueModule.enqueuePayment as jest.Mock;
const gateway = gatewayModule.simulateGateway as jest.Mock;

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-123',
    idempotency_key: 'idem-key-1',
    amount: 100,
    currency: 'USD',
    status: 'pending',
    gateway_transaction_id: null,
    retry_count: 0,
    max_retries: 3,
    error_message: null,
    metadata: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('PaymentService', () => {
  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentService();
  });

  describe('createPayment', () => {
    it('creates a new payment and enqueues it', async () => {
      const payment = makePayment();
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(payment);
      enqueue.mockResolvedValue(undefined);

      const result = await service.createPayment({
        idempotency_key: 'idem-key-1',
        amount: 100,
      });

      expect(repo.findByIdempotencyKey).toHaveBeenCalledWith('idem-key-1');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
      expect(enqueue).toHaveBeenCalledWith('pay-123');
      expect(result.id).toBe('pay-123');
    });

    it('returns existing payment for duplicate idempotency key', async () => {
      const existing = makePayment({ status: 'success' });
      repo.findByIdempotencyKey.mockResolvedValue(existing);

      const result = await service.createPayment({
        idempotency_key: 'idem-key-1',
        amount: 100,
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      expect(result.status).toBe('success');
    });
  });

  describe('processPayment', () => {
    it('transitions pending → processing → success on gateway success', async () => {
      const processing = makePayment({ status: 'processing' });
      const success = makePayment({ status: 'success', gateway_transaction_id: 'txn_abc' });

      repo.updateStatus
        .mockResolvedValueOnce(processing) // pending → processing
        .mockResolvedValueOnce(success);   // processing → success

      gateway.mockResolvedValue({ success: true, transaction_id: 'txn_abc', retriable: false });

      await service.processPayment('pay-123');

      expect(repo.updateStatus).toHaveBeenCalledTimes(2);
      expect(repo.updateStatus).toHaveBeenNthCalledWith(
        1, 'pay-123', 'pending', 'processing', { increment_retry_count: true }
      );
      expect(repo.updateStatus).toHaveBeenNthCalledWith(
        2, 'pay-123', 'processing', 'success', { gateway_transaction_id: 'txn_abc' }
      );
    });

    it('marks failed permanently for non-retriable gateway error', async () => {
      const processing = makePayment({ status: 'processing' });
      repo.updateStatus.mockResolvedValueOnce(processing).mockResolvedValueOnce(makePayment({ status: 'failed' }));
      gateway.mockResolvedValue({ success: false, error: 'Card declined', retriable: false });

      await service.processPayment('pay-123');

      expect(repo.updateStatus).toHaveBeenNthCalledWith(
        2, 'pay-123', 'processing', 'failed', expect.objectContaining({ error_message: 'Card declined' })
      );
    });

    it('throws and reverts to pending for retriable gateway error', async () => {
      const processing = makePayment({ status: 'processing' });
      repo.updateStatus.mockResolvedValueOnce(processing).mockResolvedValueOnce(makePayment({ status: 'pending' }));
      gateway.mockResolvedValue({ success: false, error: 'Network error', retriable: true });

      await expect(service.processPayment('pay-123')).rejects.toThrow('Network error');

      expect(repo.updateStatus).toHaveBeenNthCalledWith(
        2, 'pay-123', 'processing', 'pending', expect.objectContaining({ error_message: 'Network error' })
      );
    });

    it('handles timeout and re-throws for BullMQ retry', async () => {
      const processing = makePayment({ status: 'processing' });
      const pendingAfterTimeout = makePayment({ retry_count: 1, max_retries: 3 });
      repo.updateStatus
        .mockResolvedValueOnce(processing)
        .mockResolvedValueOnce(pendingAfterTimeout);

      const { GatewayTimeoutError } = gatewayModule;
      gateway.mockRejectedValue(new GatewayTimeoutError());

      await expect(service.processPayment('pay-123')).rejects.toThrow('Gateway request timed out');
    });

    it('skips processing if payment already in terminal state', async () => {
      repo.updateStatus.mockResolvedValueOnce(null); // lock not acquired

      await service.processPayment('pay-123');

      expect(gateway).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('applies webhook update to matching payment', async () => {
      const payment = makePayment({ status: 'success', gateway_transaction_id: 'txn_abc' });
      repo.saveWebhookEvent.mockResolvedValue(undefined);
      repo.applyWebhook.mockResolvedValue(payment);

      await service.handleWebhook({
        transaction_id: 'txn_abc',
        payment_id: 'pay-123',
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      expect(repo.saveWebhookEvent).toHaveBeenCalled();
      expect(repo.applyWebhook).toHaveBeenCalledWith('txn_abc', 'pay-123', 'success', undefined);
    });

    it('handles duplicate webhook gracefully (no matching payment)', async () => {
      repo.saveWebhookEvent.mockResolvedValue(undefined);
      repo.applyWebhook.mockResolvedValue(null);

      // Should not throw
      await expect(
        service.handleWebhook({
          transaction_id: 'txn_unknown',
          status: 'success',
          timestamp: new Date().toISOString(),
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('getPayment', () => {
    it('returns payment by id', async () => {
      const payment = makePayment();
      repo.findById.mockResolvedValue(payment);
      const result = await service.getPayment('pay-123');
      expect(result).toEqual(payment);
    });

    it('returns null if not found', async () => {
      repo.findById.mockResolvedValue(null);
      const result = await service.getPayment('nonexistent');
      expect(result).toBeNull();
    });
  });
});
