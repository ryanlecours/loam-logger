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
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('logs context and message', () => {
    const error = new Error('Test error');
    // Remove stack to simplify test
    error.stack = undefined;

    logError('TestContext', error);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[TestContext]', 'Test error');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('includes error code when present', () => {
    const error = new Error('Connection refused') as NodeJS.ErrnoException;
    error.code = 'ECONNREFUSED';
    error.stack = undefined;

    logError('Network', error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Network]',
      'Connection refused (ECONNREFUSED)'
    );
  });

  it('logs stack trace on separate line', () => {
    const error = new Error('Test error');

    logError('TestContext', error);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, '[TestContext]', 'Test error');
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('Error: Test error'));
  });

  it('handles null errors', () => {
    logError('NullTest', null);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[NullTest]', 'null');
  });

  it('handles undefined errors', () => {
    logError('UndefinedTest', undefined);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[UndefinedTest]', 'undefined');
  });

  it('handles string errors', () => {
    logError('StringTest', 'Something went wrong');

    expect(consoleErrorSpy).toHaveBeenCalledWith('[StringTest]', 'Something went wrong');
  });
});
