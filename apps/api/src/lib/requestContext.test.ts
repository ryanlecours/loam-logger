import {
  runWithRequestContext,
  createRequestContext,
  getRequestContext,
  getRequestId,
  getUserId,
  getOperationName,
  enrichRequestContext,
  generateRequestId,
} from './requestContext';

describe('requestContext', () => {
  describe('generateRequestId', () => {
    it('generates unique UUIDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('createRequestContext', () => {
    it('creates context with generated requestId', () => {
      const ctx = createRequestContext('GET', '/test');

      expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(ctx.method).toBe('GET');
      expect(ctx.path).toBe('/test');
      expect(ctx.startTime).toBeDefined();
    });

    it('uses existing requestId when provided', () => {
      const existingId = 'existing-request-id-123';
      const ctx = createRequestContext('POST', '/api', existingId);

      expect(ctx.requestId).toBe(existingId);
    });
  });

  describe('runWithRequestContext', () => {
    it('provides context within callback', () => {
      const context = createRequestContext('GET', '/test');

      runWithRequestContext(context, () => {
        const retrieved = getRequestContext();
        expect(retrieved).toBe(context);
        expect(retrieved?.method).toBe('GET');
        expect(retrieved?.path).toBe('/test');
      });
    });

    it('isolates context between concurrent requests', async () => {
      const results: string[] = [];

      const req1 = new Promise<void>((resolve) => {
        const ctx = createRequestContext('GET', '/req1');
        runWithRequestContext(ctx, async () => {
          await new Promise((r) => setTimeout(r, 10)); // Simulate async work
          results.push(`req1:${getRequestId()}`);
          resolve();
        });
      });

      const req2 = new Promise<void>((resolve) => {
        const ctx = createRequestContext('POST', '/req2');
        runWithRequestContext(ctx, () => {
          results.push(`req2:${getRequestId()}`);
          resolve();
        });
      });

      await Promise.all([req1, req2]);

      // Each request should have its own requestId
      const req1Result = results.find((r) => r.startsWith('req1:'))!;
      const req2Result = results.find((r) => r.startsWith('req2:'))!;

      const req1Id = req1Result.split(':')[1];
      const req2Id = req2Result.split(':')[1];

      expect(req1Id).not.toBe(req2Id);
    });

    it('returns undefined outside context', () => {
      expect(getRequestContext()).toBeUndefined();
      expect(getRequestId()).toBe('no-request-context');
      expect(getUserId()).toBeUndefined();
      expect(getOperationName()).toBeUndefined();
    });
  });

  describe('enrichRequestContext', () => {
    it('adds userId to existing context', () => {
      const context = createRequestContext('GET', '/test');

      runWithRequestContext(context, () => {
        expect(getRequestContext()?.userId).toBeUndefined();

        enrichRequestContext({ userId: 'user-123' });

        expect(getRequestContext()?.userId).toBe('user-123');
        expect(getUserId()).toBe('user-123');
      });
    });

    it('adds operationName to existing context', () => {
      const context = createRequestContext('POST', '/graphql');

      runWithRequestContext(context, () => {
        enrichRequestContext({ operationName: 'GetBikes' });

        expect(getRequestContext()?.operationName).toBe('GetBikes');
        expect(getOperationName()).toBe('GetBikes');
        // requestId should remain unchanged
        expect(getRequestContext()?.requestId).toBe(context.requestId);
      });
    });

    it('can enrich multiple fields', () => {
      const context = createRequestContext('POST', '/graphql');

      runWithRequestContext(context, () => {
        enrichRequestContext({ userId: 'user-456', operationName: 'CreateRide' });

        expect(getUserId()).toBe('user-456');
        expect(getOperationName()).toBe('CreateRide');
        expect(getRequestId()).toBe(context.requestId);
      });
    });

    it('does nothing outside context', () => {
      // Should not throw
      enrichRequestContext({ userId: 'user-123' });
      expect(getRequestContext()).toBeUndefined();
    });
  });

  describe('context isolation with async operations', () => {
    it('maintains context across async/await', async () => {
      const context = createRequestContext('GET', '/async-test');

      await runWithRequestContext(context, async () => {
        enrichRequestContext({ userId: 'async-user' });

        // Simulate async database call
        await new Promise((r) => setTimeout(r, 5));

        expect(getUserId()).toBe('async-user');
        expect(getRequestId()).toBe(context.requestId);

        // Another async operation
        await Promise.resolve();

        expect(getUserId()).toBe('async-user');
      });
    });

    it('does not bleed context between nested async operations', async () => {
      const results: { id: string; user: string | undefined }[] = [];

      const operation1 = runWithRequestContext(createRequestContext('GET', '/op1'), async () => {
        enrichRequestContext({ userId: 'user-op1' });
        await new Promise((r) => setTimeout(r, 15));
        results.push({ id: 'op1', user: getUserId() });
      });

      const operation2 = runWithRequestContext(createRequestContext('GET', '/op2'), async () => {
        enrichRequestContext({ userId: 'user-op2' });
        await new Promise((r) => setTimeout(r, 5));
        results.push({ id: 'op2', user: getUserId() });
      });

      await Promise.all([operation1, operation2]);

      const op1Result = results.find((r) => r.id === 'op1');
      const op2Result = results.find((r) => r.id === 'op2');

      expect(op1Result?.user).toBe('user-op1');
      expect(op2Result?.user).toBe('user-op2');
    });
  });
});
