// Mock connection first (before any imports that use it)
jest.mock('./connection', () => ({
  getQueueConnection: jest.fn(() => ({
    connection: {
      host: 'localhost',
      port: 6379,
    },
  })),
}));

// Create mock functions we can control per test
const mockQueueAdd = jest.fn().mockResolvedValue({});
const mockQueueClose = jest.fn().mockResolvedValue(undefined);

// Mock bullmq
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
}));

import { getEmailQueue, scheduleWelcomeSeries, closeEmailQueue, WELCOME_EMAIL_DELAYS } from './email.queue';

describe('WELCOME_EMAIL_DELAYS', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('should have correct delay for WELCOME_1 (1 day)', () => {
    expect(WELCOME_EMAIL_DELAYS.WELCOME_1).toBe(1 * DAY_MS);
  });

  it('should have correct delay for WELCOME_2 (3 days)', () => {
    expect(WELCOME_EMAIL_DELAYS.WELCOME_2).toBe(3 * DAY_MS);
  });

  it('should have correct delay for WELCOME_3 (7 days)', () => {
    expect(WELCOME_EMAIL_DELAYS.WELCOME_3).toBe(7 * DAY_MS);
  });
});

describe('getEmailQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closeEmailQueue();
  });

  afterEach(async () => {
    await closeEmailQueue();
  });

  it('should return the same queue instance on subsequent calls', () => {
    const queue1 = getEmailQueue();
    const queue2 = getEmailQueue();

    expect(queue1).toBe(queue2);
  });
});

describe('scheduleWelcomeSeries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closeEmailQueue();
    mockQueueAdd.mockResolvedValue({});
  });

  afterEach(async () => {
    await closeEmailQueue();
  });

  it('should schedule 3 welcome emails with correct delays', async () => {
    await scheduleWelcomeSeries('user123', 'test@example.com');

    expect(mockQueueAdd).toHaveBeenCalledTimes(3);
  });

  it('should schedule welcome-1 with 1 day delay', async () => {
    await scheduleWelcomeSeries('user123', 'test@example.com');

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'welcome-1',
      { userId: 'user123', email: 'test@example.com', name: undefined },
      { delay: WELCOME_EMAIL_DELAYS.WELCOME_1, jobId: 'welcome-1-user123' }
    );
  });

  it('should schedule welcome-2 with 3 day delay', async () => {
    await scheduleWelcomeSeries('user123', 'test@example.com');

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'welcome-2',
      { userId: 'user123', email: 'test@example.com', name: undefined },
      { delay: WELCOME_EMAIL_DELAYS.WELCOME_2, jobId: 'welcome-2-user123' }
    );
  });

  it('should schedule welcome-3 with 7 day delay', async () => {
    await scheduleWelcomeSeries('user123', 'test@example.com');

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'welcome-3',
      { userId: 'user123', email: 'test@example.com', name: undefined },
      { delay: WELCOME_EMAIL_DELAYS.WELCOME_3, jobId: 'welcome-3-user123' }
    );
  });

  it('should include name when provided', async () => {
    await scheduleWelcomeSeries('user123', 'test@example.com', 'John Doe');

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'welcome-1',
      { userId: 'user123', email: 'test@example.com', name: 'John Doe' },
      expect.any(Object)
    );
  });

  it('should use deterministic job IDs for idempotency', async () => {
    await scheduleWelcomeSeries('user123', 'test@example.com');

    // Verify job IDs are deterministic
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'welcome-1',
      expect.any(Object),
      expect.objectContaining({ jobId: 'welcome-1-user123' })
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'welcome-2',
      expect.any(Object),
      expect.objectContaining({ jobId: 'welcome-2-user123' })
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'welcome-3',
      expect.any(Object),
      expect.objectContaining({ jobId: 'welcome-3-user123' })
    );
  });
});

describe('closeEmailQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should close the queue if it exists', async () => {
    // Initialize the queue
    getEmailQueue();

    await closeEmailQueue();

    expect(mockQueueClose).toHaveBeenCalled();
  });

  it('should be safe to call multiple times', async () => {
    await closeEmailQueue();
    await closeEmailQueue();
    // No error thrown
  });
});
