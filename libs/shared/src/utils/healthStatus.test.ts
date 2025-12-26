import { getHealthStatus, getBgColor, getBorderColor } from './healthStatus';

describe('getHealthStatus', () => {
  describe('ok status (< 50 hours)', () => {
    it('should return ok for 0 hours', () => {
      expect(getHealthStatus(0)).toBe('ok');
    });

    it('should return ok for 49 hours', () => {
      expect(getHealthStatus(49)).toBe('ok');
    });

    it('should return ok for 49.99 hours', () => {
      expect(getHealthStatus(49.99)).toBe('ok');
    });
  });

  describe('warning status (>= 50 and < 200 hours)', () => {
    it('should return warning for exactly 50 hours', () => {
      expect(getHealthStatus(50)).toBe('warning');
    });

    it('should return warning for 100 hours', () => {
      expect(getHealthStatus(100)).toBe('warning');
    });

    it('should return warning for 199 hours', () => {
      expect(getHealthStatus(199)).toBe('warning');
    });

    it('should return warning for 199.99 hours', () => {
      expect(getHealthStatus(199.99)).toBe('warning');
    });
  });

  describe('danger status (>= 200 hours)', () => {
    it('should return danger for exactly 200 hours', () => {
      expect(getHealthStatus(200)).toBe('danger');
    });

    it('should return danger for 201 hours', () => {
      expect(getHealthStatus(201)).toBe('danger');
    });

    it('should return danger for very large numbers', () => {
      expect(getHealthStatus(10000)).toBe('danger');
    });
  });
});

describe('getBgColor', () => {
  describe('green (ok) background (< 50 hours)', () => {
    it('should return bg-green-50 for 0 hours', () => {
      expect(getBgColor(0)).toBe('bg-green-50');
    });

    it('should return bg-green-50 for 49 hours', () => {
      expect(getBgColor(49)).toBe('bg-green-50');
    });
  });

  describe('yellow (warning) background (>= 50 and < 200 hours)', () => {
    it('should return bg-yellow-50 for 50 hours', () => {
      expect(getBgColor(50)).toBe('bg-yellow-50');
    });

    it('should return bg-yellow-50 for 199 hours', () => {
      expect(getBgColor(199)).toBe('bg-yellow-50');
    });
  });

  describe('red (danger) background (>= 200 hours)', () => {
    it('should return bg-red-50 for 200 hours', () => {
      expect(getBgColor(200)).toBe('bg-red-50');
    });

    it('should return bg-red-50 for 500 hours', () => {
      expect(getBgColor(500)).toBe('bg-red-50');
    });
  });
});

describe('getBorderColor', () => {
  describe('green (ok) border (< 50 hours)', () => {
    it('should return border-green-500 for 0 hours', () => {
      expect(getBorderColor(0)).toBe('border-green-500');
    });

    it('should return border-green-500 for 49 hours', () => {
      expect(getBorderColor(49)).toBe('border-green-500');
    });
  });

  describe('yellow (warning) border (>= 50 and < 200 hours)', () => {
    it('should return border-yellow-500 for 50 hours', () => {
      expect(getBorderColor(50)).toBe('border-yellow-500');
    });

    it('should return border-yellow-500 for 199 hours', () => {
      expect(getBorderColor(199)).toBe('border-yellow-500');
    });
  });

  describe('red (danger) border (>= 200 hours)', () => {
    it('should return border-red-500 for 200 hours', () => {
      expect(getBorderColor(200)).toBe('border-red-500');
    });

    it('should return border-red-500 for 500 hours', () => {
      expect(getBorderColor(500)).toBe('border-red-500');
    });
  });
});

describe('consistency across functions', () => {
  const testCases = [
    { hours: 0, status: 'ok', bg: 'bg-green-50', border: 'border-green-500' },
    { hours: 49, status: 'ok', bg: 'bg-green-50', border: 'border-green-500' },
    { hours: 50, status: 'warning', bg: 'bg-yellow-50', border: 'border-yellow-500' },
    { hours: 199, status: 'warning', bg: 'bg-yellow-50', border: 'border-yellow-500' },
    { hours: 200, status: 'danger', bg: 'bg-red-50', border: 'border-red-500' },
    { hours: 1000, status: 'danger', bg: 'bg-red-50', border: 'border-red-500' },
  ];

  it.each(testCases)(
    'should be consistent for $hours hours',
    ({ hours, status, bg, border }) => {
      expect(getHealthStatus(hours)).toBe(status);
      expect(getBgColor(hours)).toBe(bg);
      expect(getBorderColor(hours)).toBe(border);
    }
  );
});
