import request from 'supertest';
import { app } from '../src/app';
import { paymentService } from '../src/services/payment.service';
import { Payment } from '../src/types/payment';

jest.mock('../src/services/payment.service', () => ({
  paymentService: {
    createPayment: jest.fn(),
    getPayment: jest.fn(),
    handleWebhook: jest.fn(),
  },
}));

const svc = paymentService as jest.Mocked<typeof paymentService>;

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-123',
    idempotency_key: 'key-1',
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

describe('API Routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/payments', () => {
    it('creates a payment and returns 201', async () => {
      svc.createPayment.mockResolvedValue(makePayment());

      const res = await request(app)
        .post('/api/payments')
        .send({ idempotency_key: 'key-1', amount: 100 });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('pay-123');
    });

    it('returns 400 for missing idempotency_key', async () => {
      const res = await request(app).post('/api/payments').send({ amount: 100 });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid amount', async () => {
      const res = await request(app)
        .post('/api/payments')
        .send({ idempotency_key: 'key-1', amount: -5 });
      expect(res.status).toBe(400);
    });

    it('returns 400 for zero amount', async () => {
      const res = await request(app)
        .post('/api/payments')
        .send({ idempotency_key: 'key-1', amount: 0 });
      expect(res.status).toBe(400);
    });

    it('returns 201 with existing payment for duplicate idempotency key', async () => {
      svc.createPayment.mockResolvedValue(makePayment({ status: 'success' }));

      const res = await request(app)
        .post('/api/payments')
        .send({ idempotency_key: 'key-1', amount: 100 });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('returns 500 on service error', async () => {
      svc.createPayment.mockRejectedValue(new Error('DB down'));

      const res = await request(app)
        .post('/api/payments')
        .send({ idempotency_key: 'key-1', amount: 100 });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/payments/:id', () => {
    it('returns payment by id', async () => {
      svc.getPayment.mockResolvedValue(makePayment({ status: 'processing' }));

      const res = await request(app).get('/api/payments/00000000-0000-4000-8000-000000000001');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('processing');
    });

    it('returns 404 if payment not found', async () => {
      svc.getPayment.mockResolvedValue(null);

      const res = await request(app).get('/api/payments/00000000-0000-4000-8000-000000000002');
      expect(res.status).toBe(404);
    });

    it('returns 400 for non-UUID id', async () => {
      const res = await request(app).get('/api/payments/not-a-uuid');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/webhooks/payment', () => {
    it('processes a valid webhook', async () => {
      svc.handleWebhook.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/webhooks/payment')
        .send({
          transaction_id: 'txn_abc',
          status: 'success',
          timestamp: new Date().toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app)
        .post('/api/webhooks/payment')
        .send({
          transaction_id: 'txn_abc',
          status: 'unknown',
          timestamp: new Date().toISOString(),
        });

      expect(res.status).toBe(400);
    });

    it('handles duplicate webhook gracefully', async () => {
      svc.handleWebhook.mockResolvedValue(undefined);

      // Send the same webhook twice
      await request(app).post('/api/webhooks/payment').send({
        transaction_id: 'txn_dup',
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      const res = await request(app).post('/api/webhooks/payment').send({
        transaction_id: 'txn_dup',
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/health', () => {
    it('returns ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
