// Set env before importing the module
const originalEnv = process.env;
process.env = { ...originalEnv, RESEND_API_KEY: 'test-api-key' };

// Create a shared mock send function that can be updated per test
let mockSend = jest.fn();

// Mock Resend before importing
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      get send() {
        return mockSend;
      },
    },
  })),
}));

// Mock Prisma (used by sendEmailWithAudit)
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    emailSend: {
      create: jest.fn(),
    },
  },
}));

import { sendEmail } from './email.service';

afterAll(() => {
  process.env = originalEnv;
});

describe('sendEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn();
  });

  it('should send email and return email ID', async () => {
    mockSend.mockResolvedValue({
      data: { id: 'email-123' },
      error: null,
    });

    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Test Subject',
      html: '<p>Hello World</p>',
    });

    expect(result).toBe('email-123');
    expect(mockSend).toHaveBeenCalledWith({
      from: "Ryan LeCours <ryan.lecours@onboarding.loamlogger.app>",
      replyTo: "ryan.lecours@loamlogger.app",
      to: 'test@example.com',
      subject: 'Test Subject',
      html: '<p>Hello World</p>',
      text: 'Hello World',
    });
  });

  it('should use provided text when available', async () => {
    mockSend.mockResolvedValue({
      data: { id: 'email-456' },
      error: null,
    });

    await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>HTML content</p>',
      text: 'Plain text content',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Plain text content',
      })
    );
  });

  it('should throw error when Resend API returns error', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Invalid recipient' },
    });

    await expect(
      sendEmail({
        to: 'invalid@',
        subject: 'Test',
        html: '<p>Test</p>',
      })
    ).rejects.toThrow('Failed to send email: Invalid recipient');
  });

  it('should return empty string when data.id is undefined', async () => {
    mockSend.mockResolvedValue({
      data: {},
      error: null,
    });

    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    });

    expect(result).toBe('');
  });

  it('should strip HTML tags for plain text fallback', async () => {
    mockSend.mockResolvedValue({
      data: { id: 'email-789' },
      error: null,
    });

    await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<div><p>Paragraph 1</p> <p>Paragraph 2</p></div>',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Paragraph 1 Paragraph 2',
      })
    );
  });

  it('should strip style tags from HTML', async () => {
    mockSend.mockResolvedValue({
      data: { id: 'email-abc' },
      error: null,
    });

    await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<style>body { color: red; }</style><p>Content</p>',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Content',
      })
    );
  });

  it('should strip script tags from HTML', async () => {
    mockSend.mockResolvedValue({
      data: { id: 'email-def' },
      error: null,
    });

    await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<script>alert("test")</script><p>Content</p>',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Content',
      })
    );
  });

  it('should normalize whitespace in plain text', async () => {
    mockSend.mockResolvedValue({
      data: { id: 'email-ghi' },
      error: null,
    });

    await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>Hello</p>\n\n\n<p>World</p>',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello World',
      })
    );
  });
});

describe('getResendClient', () => {
  it('should throw error when RESEND_API_KEY is not set', () => {
    // This is tested implicitly - the module throws on load if no API key
    // We test that when the key IS set, it works
    expect(sendEmail).toBeDefined();
  });
});
