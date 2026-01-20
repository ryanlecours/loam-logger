import { safeErrorInfo, logError } from './logger';

describe('safeErrorInfo', () => {
  it('extracts message, name, and stack from Error', () => {
    const error = new Error('Something went wrong');

    const info = safeErrorInfo(error);

    expect(info.message).toBe('Something went wrong');
    expect(info.name).toBe('Error');
    expect(info.stack).toBeDefined();
    expect(info.stack).toContain('Something went wrong');
  });

  it('handles Error with code (NodeJS.ErrnoException)', () => {
    const error = new Error('Connection refused') as NodeJS.ErrnoException;
    error.code = 'ECONNREFUSED';

    const info = safeErrorInfo(error);

    expect(info.message).toBe('Connection refused');
    expect(info.code).toBe('ECONNREFUSED');
  });

  it('handles custom error names', () => {
    const error = new TypeError('Invalid type');

    const info = safeErrorInfo(error);

    expect(info.name).toBe('TypeError');
    expect(info.message).toBe('Invalid type');
  });

  it('handles Error with empty message', () => {
    const error = new Error('');

    const info = safeErrorInfo(error);

    expect(info.message).toBe('Unknown error');
  });

  it('handles string values', () => {
    const info = safeErrorInfo('Something failed');

    expect(info.message).toBe('Something failed');
    expect(info.name).toBeUndefined();
    expect(info.code).toBeUndefined();
    expect(info.stack).toBeUndefined();
  });

  it('handles null', () => {
    const info = safeErrorInfo(null);

    expect(info.message).toBe('null');
  });

  it('handles undefined', () => {
    const info = safeErrorInfo(undefined);

    expect(info.message).toBe('undefined');
  });

  it('handles objects', () => {
    const info = safeErrorInfo({ error: 'bad request' });

    expect(info.message).toBe('[object Object]');
  });

  it('handles numbers', () => {
    const info = safeErrorInfo(404);

    expect(info.message).toBe('404');
  });
});

describe('logError', () => {
  // Note: logError now uses pino logger internally.
  // We test that it doesn't throw and handles various error types.
  // The actual logging output is handled by pino.

  it('does not throw for Error objects', () => {
    const error = new Error('Test error');

    expect(() => logError('TestContext', error)).not.toThrow();
  });

  it('does not throw for Error with code', () => {
    const error = new Error('Connection refused') as NodeJS.ErrnoException;
    error.code = 'ECONNREFUSED';

    expect(() => logError('Network', error)).not.toThrow();
  });

  it('does not throw for null errors', () => {
    expect(() => logError('NullTest', null)).not.toThrow();
  });

  it('does not throw for undefined errors', () => {
    expect(() => logError('UndefinedTest', undefined)).not.toThrow();
  });

  it('does not throw for string errors', () => {
    expect(() => logError('StringTest', 'Something went wrong')).not.toThrow();
  });
});
