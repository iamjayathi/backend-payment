import { CircuitBreaker, CircuitOpenError } from '../src/resilience/circuit-breaker';

function makeBreaker(opts?: Partial<ConstructorParameters<typeof CircuitBreaker>[1]>) {
  return new CircuitBreaker('test', {
    failureThreshold: 3,
    successThreshold: 1,
    resetTimeoutMs: 500,
    ...opts,
  });
}

const success = () => Promise.resolve('ok');
const failure = () => Promise.reject(new Error('boom'));

describe('CircuitBreaker', () => {
  it('starts CLOSED and passes calls through', async () => {
    const cb = makeBreaker();
    const result = await cb.call(success);
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after failureThreshold consecutive failures', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await cb.call(failure).catch(() => {});
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('fails fast with CircuitOpenError when OPEN', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await cb.call(failure).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    await expect(cb.call(success)).rejects.toThrow(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after resetTimeout', async () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    await cb.call(failure).catch(() => {});
    expect(cb.getState()).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 60));

    // Next call is allowed through (HALF_OPEN probe)
    const result = await cb.call(success);
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('returns to OPEN if the HALF_OPEN probe fails', async () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    await cb.call(failure).catch(() => {});
    await new Promise((r) => setTimeout(r, 60));

    // Probe fails → back to OPEN
    await cb.call(failure).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('closes after successThreshold successes in HALF_OPEN', async () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 50, successThreshold: 2 });
    await cb.call(failure).catch(() => {});
    await new Promise((r) => setTimeout(r, 60));

    await cb.call(success); // 1st success → still HALF_OPEN
    expect(cb.getState()).toBe('HALF_OPEN');

    await cb.call(success); // 2nd success → CLOSED
    expect(cb.getState()).toBe('CLOSED');
  });

  it('resets failure count on success in CLOSED state', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    await cb.call(failure).catch(() => {});
    await cb.call(failure).catch(() => {});
    expect(cb.getStats().failureCount).toBe(2);

    await cb.call(success);
    expect(cb.getStats().failureCount).toBe(0);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('exposes stats', () => {
    const cb = makeBreaker();
    const stats = cb.getStats();
    expect(stats).toHaveProperty('state', 'CLOSED');
    expect(stats).toHaveProperty('failureCount', 0);
    expect(stats).toHaveProperty('lastFailureTime', null);
  });
});
