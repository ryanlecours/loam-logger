// Set env before importing the module
const originalEnv = process.env;
process.env = { ...originalEnv, SESSION_SECRET: 'test-secret-key' };

// Import jwt first so we can mock it
import * as jwt from 'jsonwebtoken';
jest.mock('jsonwebtoken');
const mockedJwt = jwt as jest.Mocked<typeof jwt>;

// Now import the module under test
import { generateUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token';

afterAll(() => {
  process.env = originalEnv;
});

describe('generateUnsubscribeToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate token with 90d expiry', () => {
    mockedJwt.sign.mockReturnValue('unsubscribe_token' as never);

    const result = generateUnsubscribeToken('user123');

    expect(mockedJwt.sign).toHaveBeenCalledWith(
      { uid: 'user123', purpose: 'unsubscribe' },
      'test-secret-key',
      { expiresIn: '90d' }
    );
    expect(result).toBe('unsubscribe_token');
  });

  it('should include purpose field in payload', () => {
    mockedJwt.sign.mockReturnValue('token' as never);

    generateUnsubscribeToken('user456');

    expect(mockedJwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'unsubscribe' }),
      expect.any(String),
      expect.any(Object)
    );
  });
});

describe('verifyUnsubscribeToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return userId for valid unsubscribe token', () => {
    const payload = { uid: 'user123', purpose: 'unsubscribe' };
    mockedJwt.verify.mockReturnValue(payload as never);

    const result = verifyUnsubscribeToken('valid_token');

    expect(mockedJwt.verify).toHaveBeenCalledWith('valid_token', 'test-secret-key');
    expect(result).toEqual({ userId: 'user123' });
  });

  it('should return null for expired token', () => {
    mockedJwt.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    const result = verifyUnsubscribeToken('expired_token');

    expect(result).toBeNull();
  });

  it('should return null for malformed token', () => {
    mockedJwt.verify.mockImplementation(() => {
      throw new Error('jwt malformed');
    });

    const result = verifyUnsubscribeToken('malformed_token');

    expect(result).toBeNull();
  });

  it('should return null for invalid signature', () => {
    mockedJwt.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const result = verifyUnsubscribeToken('tampered_token');

    expect(result).toBeNull();
  });

  it('should return null if purpose is not unsubscribe', () => {
    const payload = { uid: 'user123', purpose: 'access' };
    mockedJwt.verify.mockReturnValue(payload as never);

    const result = verifyUnsubscribeToken('wrong_purpose_token');

    expect(result).toBeNull();
  });

  it('should return null if uid is missing', () => {
    const payload = { purpose: 'unsubscribe' };
    mockedJwt.verify.mockReturnValue(payload as never);

    const result = verifyUnsubscribeToken('missing_uid_token');

    expect(result).toBeNull();
  });

  it('should return null if uid is empty string', () => {
    const payload = { uid: '', purpose: 'unsubscribe' };
    mockedJwt.verify.mockReturnValue(payload as never);

    const result = verifyUnsubscribeToken('empty_uid_token');

    expect(result).toBeNull();
  });
});

describe('SESSION_SECRET validation', () => {
  it('should have functions defined when SESSION_SECRET is set', () => {
    expect(generateUnsubscribeToken).toBeDefined();
    expect(verifyUnsubscribeToken).toBeDefined();
  });
});
