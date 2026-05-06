import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { paymentController } from '../controllers/payment.controller';
import { paymentCreationLimiter } from '../middleware/rate-limiter';

export const router = Router();

router.post(
  '/payments',
  paymentCreationLimiter,
  [
    body('idempotency_key').isString().notEmpty(),
    body('amount').isFloat({ min: 0.01 }),
    body('currency').optional().isLength({ min: 3, max: 3 }),
    body('metadata').optional().isObject(),
  ],
  paymentController.createPayment
);

router.get(
  '/payments/:id',
  [param('id').isUUID()],
  paymentController.getPayment
);

router.post(
  '/webhooks/payment',
  [
    body('transaction_id').isString().notEmpty(),
    body('payment_id').optional().isUUID(),
    body('status').isIn(['success', 'failed']),
    body('timestamp').isISO8601(),
    body('error').optional().isString(),
  ],
  paymentController.handleWebhook
);

router.get('/health', paymentController.getHealth);

router.get(
  '/admin/dlq',
  [query('limit').optional().isInt({ min: 1, max: 200 }).toInt()],
  paymentController.getDLQ
);
