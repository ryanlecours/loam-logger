// Mock dependencies before imports
jest.mock('../lib/queue/connection', () => ({
  getQueueConnection: jest.fn(() => ({
    connection: { host: 'localhost', port: 6379 },
  })),
}));

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../services/email.service', () => ({
  sendEmail: jest.fn().mockResolvedValue('email-id'),
}));

jest.mock('../templates/emails', () => ({
  getActivationEmailSubject: jest.fn().mockReturnValue('Activation Subject'),
  getActivationEmailHtml: jest.fn().mockReturnValue('<p>Activation HTML</p>'),
  getWelcome1Subject: jest.fn().mockReturnValue('Welcome 1 Subject'),
  getWelcome1Html: jest.fn().mockReturnValue('<p>Welcome 1 HTML</p>'),
  getWelcome2Subject: jest.fn().mockReturnValue('Welcome 2 Subject'),
  getWelcome2Html: jest.fn().mockReturnValue('<p>Welcome 2 HTML</p>'),
  getWelcome3Subject: jest.fn().mockReturnValue('Welcome 3 Subject'),
  getWelcome3Html: jest.fn().mockReturnValue('<p>Welcome 3 HTML</p>'),
}));

import { createEmailWorker, closeEmailWorker } from './email.worker';
import { Worker } from 'bullmq';
import { sendEmail } from '../services/email.service';
import {
  getActivationEmailHtml,
  getWelcome1Html,
  getWelcome2Html,
  getWelcome3Html,
} from '../templates/emails';

const MockedWorker = Worker as jest.MockedClass<typeof Worker>;
const mockSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockGetActivationEmailHtml = getActivationEmailHtml as jest.MockedFunction<typeof getActivationEmailHtml>;
const mockGetWelcome1Html = getWelcome1Html as jest.MockedFunction<typeof getWelcome1Html>;
const mockGetWelcome2Html = getWelcome2Html as jest.MockedFunction<typeof getWelcome2Html>;
const mockGetWelcome3Html = getWelcome3Html as jest.MockedFunction<typeof getWelcome3Html>;

describe('createEmailWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await closeEmailWorker();
  });

  it('should create a worker with correct queue name', () => {
    createEmailWorker();

    expect(MockedWorker).toHaveBeenCalledWith(
      'email',
      expect.any(Function),
      expect.objectContaining({ concurrency: 5 })
    );
  });

  it('should return the same worker on subsequent calls', () => {
    const worker1 = createEmailWorker();
    const worker2 = createEmailWorker();

    expect(worker1).toBe(worker2);
    expect(MockedWorker).toHaveBeenCalledTimes(1);
  });

  it('should set up event handlers', () => {
    const mockOn = jest.fn();
    MockedWorker.mockImplementation(() => ({
      on: mockOn,
      close: jest.fn().mockResolvedValue(undefined),
    }) as never);

    createEmailWorker();

    expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('closeEmailWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should close the worker if it exists', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    MockedWorker.mockImplementation(() => ({
      on: jest.fn(),
      close: mockClose,
    }) as never);

    createEmailWorker();
    await closeEmailWorker();

    expect(mockClose).toHaveBeenCalled();
  });

  it('should be safe to call multiple times', async () => {
    await closeEmailWorker();
    await closeEmailWorker();
    // No error thrown
  });

  it('should allow creating a new worker after closing', async () => {
    createEmailWorker();
    await closeEmailWorker();

    jest.clearAllMocks();

    createEmailWorker();
    expect(MockedWorker).toHaveBeenCalledTimes(1);
  });
});

describe('processEmailJob (via worker processor)', () => {
  let processEmailJob: (job: { name: string; data: Record<string, unknown> }) => Promise<void>;

  beforeEach(async () => {
    // Make sure any previous worker is closed
    await closeEmailWorker();
    jest.clearAllMocks();

    MockedWorker.mockImplementation((queueName, processor) => {
      processEmailJob = processor as typeof processEmailJob;
      return {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      } as never;
    });

    createEmailWorker();
  });

  afterEach(async () => {
    await closeEmailWorker();
  });

  describe('validation', () => {
    it('should throw when userId is missing', async () => {
      await expect(
        processEmailJob({
          name: 'activation',
          data: { email: 'test@example.com', tempPassword: 'pass123' },
        })
      ).rejects.toThrow('Invalid job data: userId is required');
    });

    it('should throw when userId is empty string', async () => {
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: '  ', email: 'test@example.com', tempPassword: 'pass123' },
        })
      ).rejects.toThrow('Invalid job data: userId is required');
    });

    it('should throw when email is missing', async () => {
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: 'user123', tempPassword: 'pass123' },
        })
      ).rejects.toThrow('Invalid job data: email is required');
    });

    it('should throw when email is empty', async () => {
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: 'user123', email: '  ', tempPassword: 'pass123' },
        })
      ).rejects.toThrow('Invalid job data: email cannot be empty');
    });

    it('should throw when email is too long', async () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: 'user123', email: longEmail, tempPassword: 'pass123' },
        })
      ).rejects.toThrow('Invalid job data: email exceeds 254 characters');
    });

    it('should throw when email format is invalid', async () => {
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: 'user123', email: 'not-an-email', tempPassword: 'pass123' },
        })
      ).rejects.toThrow('Invalid job data: email format is invalid');
    });

    it('should throw when name is not a string', async () => {
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: 'user123', email: 'test@example.com', name: 123, tempPassword: 'pass123' },
        })
      ).rejects.toThrow('Invalid job data: name must be a string');
    });

    it('should throw when name is too long', async () => {
      const longName = 'a'.repeat(101);
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: 'user123', email: 'test@example.com', name: longName, tempPassword: 'pass123' },
        })
      ).rejects.toThrow('Invalid job data: name exceeds 100 characters');
    });

    it('should throw when activation email is missing tempPassword', async () => {
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: 'user123', email: 'test@example.com' },
        })
      ).rejects.toThrow('Invalid job data: activation email requires tempPassword');
    });

    it('should throw when activation email has empty tempPassword', async () => {
      await expect(
        processEmailJob({
          name: 'activation',
          data: { userId: 'user123', email: 'test@example.com', tempPassword: '' },
        })
      ).rejects.toThrow('Invalid job data: activation email requires tempPassword');
    });
  });

  describe('activation job', () => {
    it('should send activation email with correct data', async () => {
      await processEmailJob({
        name: 'activation',
        data: {
          userId: 'user123',
          email: 'test@example.com',
          name: 'Test User',
          tempPassword: 'TempPass123!',
        },
      });

      expect(mockGetActivationEmailHtml).toHaveBeenCalledWith({
        name: 'Test User',
        email: 'test@example.com',
        tempPassword: 'TempPass123!',
        loginUrl: 'http://localhost:5173/login',
      });

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'Activation Subject',
        html: '<p>Activation HTML</p>',
      });
    });

    it('should normalize email to lowercase', async () => {
      await processEmailJob({
        name: 'activation',
        data: {
          userId: 'user123',
          email: 'TEST@EXAMPLE.COM',
          tempPassword: 'TempPass123!',
        },
      });

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com' })
      );
    });
  });

  describe('welcome-1 job', () => {
    it('should send welcome-1 email with correct data', async () => {
      await processEmailJob({
        name: 'welcome-1',
        data: {
          userId: 'user123',
          email: 'test@example.com',
          name: 'Test User',
        },
      });

      expect(mockGetWelcome1Html).toHaveBeenCalledWith({
        name: 'Test User',
        dashboardUrl: 'http://localhost:5173/dashboard',
      });

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'Welcome 1 Subject',
        html: '<p>Welcome 1 HTML</p>',
      });
    });
  });

  describe('welcome-2 job', () => {
    it('should send welcome-2 email with correct data', async () => {
      await processEmailJob({
        name: 'welcome-2',
        data: {
          userId: 'user123',
          email: 'test@example.com',
          name: 'Test User',
        },
      });

      expect(mockGetWelcome2Html).toHaveBeenCalledWith({
        name: 'Test User',
        gearUrl: 'http://localhost:5173/gear',
      });

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'Welcome 2 Subject',
        html: '<p>Welcome 2 HTML</p>',
      });
    });
  });

  describe('welcome-3 job', () => {
    it('should send welcome-3 email with correct data', async () => {
      await processEmailJob({
        name: 'welcome-3',
        data: {
          userId: 'user123',
          email: 'test@example.com',
          name: 'Test User',
        },
      });

      expect(mockGetWelcome3Html).toHaveBeenCalledWith({
        name: 'Test User',
        settingsUrl: 'http://localhost:5173/settings',
      });

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'Welcome 3 Subject',
        html: '<p>Welcome 3 HTML</p>',
      });
    });
  });

  describe('unknown job type', () => {
    it('should throw for unknown job type', async () => {
      await expect(
        processEmailJob({
          name: 'unknown-job' as never,
          data: {
            userId: 'user123',
            email: 'test@example.com',
          },
        })
      ).rejects.toThrow('Unknown email job type: unknown-job');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined name gracefully', async () => {
      await processEmailJob({
        name: 'welcome-1',
        data: {
          userId: 'user123',
          email: 'test@example.com',
        },
      });

      expect(mockGetWelcome1Html).toHaveBeenCalledWith({
        name: undefined,
        dashboardUrl: 'http://localhost:5173/dashboard',
      });
    });

    it('should handle empty string name as undefined', async () => {
      await processEmailJob({
        name: 'welcome-1',
        data: {
          userId: 'user123',
          email: 'test@example.com',
          name: '   ',
        },
      });

      expect(mockGetWelcome1Html).toHaveBeenCalledWith({
        name: undefined,
        dashboardUrl: 'http://localhost:5173/dashboard',
      });
    });

    it('should trim whitespace from name', async () => {
      await processEmailJob({
        name: 'welcome-1',
        data: {
          userId: 'user123',
          email: 'test@example.com',
          name: '  Test User  ',
        },
      });

      expect(mockGetWelcome1Html).toHaveBeenCalledWith({
        name: 'Test User',
        dashboardUrl: 'http://localhost:5173/dashboard',
      });
    });

    it('should trim whitespace from email', async () => {
      await processEmailJob({
        name: 'welcome-1',
        data: {
          userId: 'user123',
          email: '  test@example.com  ',
        },
      });

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com' })
      );
    });
  });
});
