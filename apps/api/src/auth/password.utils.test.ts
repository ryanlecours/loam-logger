import * as bcryptjs from 'bcryptjs';
import { hashPassword, verifyPassword } from './password.utils';

jest.mock('bcryptjs');

const mockedBcrypt = bcryptjs as jest.Mocked<typeof bcryptjs>;

describe('hashPassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should hash password with 12 salt rounds', async () => {
    mockedBcrypt.hash.mockResolvedValue('hashed_password' as never);

    const result = await hashPassword('myPassword');

    expect(mockedBcrypt.hash).toHaveBeenCalledWith('myPassword', 12);
    expect(result).toBe('hashed_password');
  });

  it('should return different hashes for different passwords', async () => {
    mockedBcrypt.hash
      .mockResolvedValueOnce('hash1' as never)
      .mockResolvedValueOnce('hash2' as never);

    const hash1 = await hashPassword('password1');
    const hash2 = await hashPassword('password2');

    expect(hash1).not.toBe(hash2);
  });

  it('should propagate errors from bcrypt', async () => {
    mockedBcrypt.hash.mockRejectedValue(new Error('Bcrypt error') as never);

    await expect(hashPassword('password')).rejects.toThrow('Bcrypt error');
  });
});

describe('verifyPassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return true for matching password', async () => {
    mockedBcrypt.compare.mockResolvedValue(true as never);

    const result = await verifyPassword('myPassword', 'hashed_password');

    expect(mockedBcrypt.compare).toHaveBeenCalledWith('myPassword', 'hashed_password');
    expect(result).toBe(true);
  });

  it('should return false for non-matching password', async () => {
    mockedBcrypt.compare.mockResolvedValue(false as never);

    const result = await verifyPassword('wrongPassword', 'hashed_password');

    expect(result).toBe(false);
  });

  it('should propagate errors from bcrypt', async () => {
    mockedBcrypt.compare.mockRejectedValue(new Error('Bcrypt error') as never);

    await expect(verifyPassword('password', 'hash')).rejects.toThrow('Bcrypt error');
  });
});
