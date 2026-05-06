export const swaggerSpec = {
  openapi: '3.0.0',

  info: {
    title: 'Payment Processing API',
    version: '1.0.0',
    description:
      'Async payment system with idempotency, retries, circuit breaker, and webhooks.',
  },

  servers: [{ url: '/api' }],

  tags: [
    { name: 'Payments' },
    { name: 'Webhooks' },
    { name: 'Admin' },
  ],

  paths: {
    '/payments': {
      post: {
        tags: ['Payments'],
        summary: 'Create payment',
        description:
          'Creates a payment. Idempotent using idempotency_key. Processed async via queue.',

        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreatePaymentRequest' },
              example: {
                idempotency_key: 'order_123',
                amount: 99.99,
                currency: 'USD',
              },
            },
          },
        },

        responses: {
          201: {
            description: 'Payment created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Payment' },
              },
            },
          },
          400: { $ref: '#/components/responses/ValidationError' },
          429: { $ref: '#/components/responses/RateLimitError' },
          500: { $ref: '#/components/responses/InternalError' },
        },
      },
    },

    '/payments/{id}': {
      get: {
        tags: ['Payments'],
        summary: 'Get payment',
        description: 'Fetch payment status by ID',

        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],

        responses: {
          200: {
            description: 'Payment found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Payment' },
              },
            },
          },
          404: { description: 'Not found' },
        },
      },
    },

  
    '/webhooks/payment': {
      post: {
        tags: ['Webhooks'],
        summary: 'Gateway callback',

        description:
          'Receives final payment status from gateway. Webhooks are stored idempotently and can be applied by transaction_id or payment_id for early callbacks.',

        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WebhookPayload' },
              example: {
                transaction_id: 'txn_123',
                payment_id: '00000000-0000-4000-8000-000000000001',
                status: 'success',
                timestamp: '2026-05-06T12:00:00Z',
              },
            },
          },
        },

        responses: {
          200: {
            description: 'Received',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    received: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/health': {
      get: {
        tags: ['Admin'],
        summary: 'Service health',

        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    timestamp: { type: 'string' },
                    circuit_breaker: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/admin/dlq': {
      get: {
        tags: ['Admin'],
        summary: 'Dead letter queue',

        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'number', default: 50 },
          },
        ],

        responses: {
          200: {
            description: 'DLQ jobs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'number' },
                    jobs: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  components: {
    schemas: {
      CreatePaymentRequest: {
        type: 'object',
        required: ['idempotency_key', 'amount'],
        properties: {
          idempotency_key: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string', default: 'USD' },
          metadata: { type: 'object' },
        },
      },

      Payment: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          gateway_transaction_id: { type: 'string', nullable: true },
        },
      },

      WebhookPayload: {
        type: 'object',
        required: ['transaction_id', 'status', 'timestamp'],
        properties: {
          transaction_id: { type: 'string' },
          payment_id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          error: { type: 'string' },
          timestamp: { type: 'string' },
        },
      },
    },

    responses: {
      ValidationError: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },

      RateLimitError: {
        description: 'Too many requests',
      },

      InternalError: {
        description: 'Server error',
      },
    },
  },
};
