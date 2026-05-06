import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { logger } from '../logger';
import { getDLQJobs } from '../queue/dlq';
import { gatewayCircuitBreaker } from '../resilience/circuit-breaker';
import { paymentService } from '../services/payment.service';
import { WebhookPayload } from '../types/payment';

function handleValidation(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

export class PaymentController {
  async createPayment(req: Request, res: Response) {
    if (!handleValidation(req, res)) return;

    try {
      const payment = await paymentService.createPayment({
        idempotency_key: req.body.idempotency_key,
        amount: Number(req.body.amount),
        currency: req.body.currency,
        metadata: req.body.metadata,
      });

      return res.status(201).json(payment);
    } catch (err) {
      logger.error('Create payment failed', { err });
      return res.status(500).json({ error: 'Server error' });
    }
  }

  async getPayment(req: Request, res: Response) {
    if (!handleValidation(req, res)) return;

    try {
      const payment = await paymentService.getPayment(req.params.id);

      if (!payment) {
        return res.status(404).json({ error: 'Not found' });
      }

      return res.json(payment);
    } catch (err) {
      logger.error('Fetch payment failed', { err });
      return res.status(500).json({ error: 'Server error' });
    }
  }

  async handleWebhook(req: Request, res: Response) {
    if (!handleValidation(req, res)) return;

    try {
      const payload: WebhookPayload = req.body;

      await paymentService.handleWebhook(payload);

      return res.json({ received: true });
    } catch (err) {
      logger.error('Webhook failed', { err });
      return res.status(500).json({ error: 'Server error' });
    }
  }

  getHealth(_req: Request, res: Response) {
    return res.json({
      status: 'ok',
      time: new Date().toISOString(),
      circuit: gatewayCircuitBreaker.getStats(),
    });
  }

  async getDLQ(req: Request, res: Response) {
    if (!handleValidation(req, res)) return;

    try {
      const limit = Number(req.query.limit || 50);
      const jobs = await getDLQJobs(limit);

      return res.json({
        count: jobs.length,
        jobs,
      });
    } catch (err) {
      logger.error('DLQ fetch failed', { err });
      return res.status(500).json({ error: 'Server error' });
    }
  }
}

export const paymentController = new PaymentController();
