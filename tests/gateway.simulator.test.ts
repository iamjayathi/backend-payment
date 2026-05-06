import { simulateGateway, GatewayTimeoutError } from '../src/gateway/gateway.simulator';

describe('GatewaySimulator', () => {
  it('returns a success or failure response', async () => {
    // Run multiple times to hit different branches
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        simulateGateway('test-payment-1', 100).catch((e) => e)
      )
    );

    for (const r of results) {
      if (r instanceof GatewayTimeoutError) {
        expect(r.name).toBe('GatewayTimeoutError');
      } else if (r instanceof Error) {
        fail('Unexpected error: ' + r.message);
      } else {
        expect(typeof r.success).toBe('boolean');
        expect(typeof r.retriable).toBe('boolean');
        if (r.success) {
          expect(r.transaction_id).toMatch(/^txn_/);
        } else {
          expect(r.error).toBeDefined();
        }
      }
    }
  });

  it('returns a transaction_id on success', async () => {
    // Mock Math.random to force success path (roll >= 0.35)
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
    const result = await simulateGateway('test-id', 50);
    spy.mockRestore();

    expect(result.success).toBe(true);
    expect(result.transaction_id).toMatch(/^txn_/);
  });

  it('returns non-retriable failure for card declined', async () => {
    // Force the failure path (0.15 <= roll < 0.35) and first error option
    const spy = jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)  // delayMs calculation: 100 + 0.5*2000 = 1100 → keep small
      .mockReturnValueOnce(0.2)  // roll → triggers failure path
      .mockReturnValueOnce(0);   // pickRandom → 'Insufficient funds'
    const result = await simulateGateway('test-id', 50);
    spy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.retriable).toBe(false);
  });

  it('throws GatewayTimeoutError on timeout path', async () => {
    // Force timeout: random delay small, roll < 0.15
    const spy = jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0)    // delayMs = 100ms
      .mockReturnValueOnce(0.05); // roll < 0.15 → timeout
    spy.mockReturnValue(0.05);

    await expect(simulateGateway('test-id', 50)).rejects.toThrow(GatewayTimeoutError);
    spy.mockRestore();
  });
});
