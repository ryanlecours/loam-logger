import type { Response } from 'express';
import {
  sendError,
  sendSuccess,
  sendUnauthorized,
  sendForbidden,
  sendNotFound,
  sendConflict,
  sendBadRequest,
  sendInternalError,
} from './api-response';

function createMockResponse(): jest.Mocked<Response> {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Response>;
  return res;
}

describe('sendError', () => {
  it('should send error with status and message', () => {
    const res = createMockResponse();

    sendError(res, 400, 'Bad request');

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bad request' });
  });

  it('should include code when provided', () => {
    const res = createMockResponse();

    sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR');

    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
    });
  });

  it('should include details when provided', () => {
    const res = createMockResponse();

    sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR', { field: 'email' });

    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: { field: 'email' },
    });
  });

  it('should include details without code', () => {
    const res = createMockResponse();

    sendError(res, 400, 'Validation failed', undefined, { field: 'email' });

    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: { field: 'email' },
    });
  });
});

describe('sendSuccess', () => {
  it('should send success with ok: true', () => {
    const res = createMockResponse();

    sendSuccess(res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('should include data when provided', () => {
    const res = createMockResponse();

    sendSuccess(res, { id: 1, name: 'Test' });

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      data: { id: 1, name: 'Test' },
    });
  });

  it('should include message when provided', () => {
    const res = createMockResponse();

    sendSuccess(res, undefined, 'Operation successful');

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      message: 'Operation successful',
    });
  });

  it('should include both data and message', () => {
    const res = createMockResponse();

    sendSuccess(res, { id: 1 }, 'Created');

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      data: { id: 1 },
      message: 'Created',
    });
  });

  it('should use custom status code', () => {
    const res = createMockResponse();

    sendSuccess(res, { id: 1 }, 'Created', 201);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should handle array data', () => {
    const res = createMockResponse();

    sendSuccess(res, [1, 2, 3]);

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      data: [1, 2, 3],
    });
  });

  it('should handle null data', () => {
    const res = createMockResponse();

    sendSuccess(res, null);

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      data: null,
    });
  });
});

describe('sendUnauthorized', () => {
  it('should send 401 with default message', () => {
    const res = createMockResponse();

    sendUnauthorized(res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  });

  it('should send 401 with custom message', () => {
    const res = createMockResponse();

    sendUnauthorized(res, 'Token expired');

    expect(res.json).toHaveBeenCalledWith({
      error: 'Token expired',
      code: 'UNAUTHORIZED',
    });
  });
});

describe('sendForbidden', () => {
  it('should send 403 with default code', () => {
    const res = createMockResponse();

    sendForbidden(res, 'Access denied');

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Access denied',
      code: 'FORBIDDEN',
    });
  });

  it('should send 403 with custom code', () => {
    const res = createMockResponse();

    sendForbidden(res, 'Admin required', 'ADMIN_REQUIRED');

    expect(res.json).toHaveBeenCalledWith({
      error: 'Admin required',
      code: 'ADMIN_REQUIRED',
    });
  });
});

describe('sendNotFound', () => {
  it('should send 404 with default message', () => {
    const res = createMockResponse();

    sendNotFound(res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Not found',
      code: 'NOT_FOUND',
    });
  });

  it('should send 404 with custom message', () => {
    const res = createMockResponse();

    sendNotFound(res, 'User not found');

    expect(res.json).toHaveBeenCalledWith({
      error: 'User not found',
      code: 'NOT_FOUND',
    });
  });
});

describe('sendConflict', () => {
  it('should send 409 with default code', () => {
    const res = createMockResponse();

    sendConflict(res, 'Resource already exists');

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Resource already exists',
      code: 'CONFLICT',
    });
  });

  it('should send 409 with custom code', () => {
    const res = createMockResponse();

    sendConflict(res, 'Email already registered', 'EMAIL_EXISTS');

    expect(res.json).toHaveBeenCalledWith({
      error: 'Email already registered',
      code: 'EMAIL_EXISTS',
    });
  });
});

describe('sendBadRequest', () => {
  it('should send 400 with default code', () => {
    const res = createMockResponse();

    sendBadRequest(res, 'Invalid input');

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid input',
      code: 'BAD_REQUEST',
    });
  });

  it('should send 400 with custom code', () => {
    const res = createMockResponse();

    sendBadRequest(res, 'Invalid email format', 'INVALID_EMAIL');

    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid email format',
      code: 'INVALID_EMAIL',
    });
  });
});

describe('sendInternalError', () => {
  it('should send 500 with default message', () => {
    const res = createMockResponse();

    sendInternalError(res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  it('should send 500 with custom message', () => {
    const res = createMockResponse();

    sendInternalError(res, 'Database connection failed');

    expect(res.json).toHaveBeenCalledWith({
      error: 'Database connection failed',
      code: 'INTERNAL_ERROR',
    });
  });
});
