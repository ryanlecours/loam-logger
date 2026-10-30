import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MaintenanceExportPanel from './MaintenanceExportPanel';
import { MAINTENANCE_EXPORT_URL, filenameFromDisposition } from '@/lib/maintenanceExport';

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => 'blob:csv');
const revokeObjectURL = vi.fn();

describe('MaintenanceExportPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the CSV with credentials and downloads it under the server filename', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Disposition': 'attachment; filename="loam-logger-maintenance-2026-10-30.csv"' }),
      blob: async () => new Blob(['﻿date,bike'], { type: 'text/csv' }),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<MaintenanceExportPanel />);
    fireEvent.click(screen.getByText('Export maintenance history (CSV)'));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(MAINTENANCE_EXPORT_URL, { credentials: 'include' });
    expect(MAINTENANCE_EXPORT_URL.endsWith('/api/export/maintenance.csv')).toBe(true);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('loam-logger-maintenance-2026-10-30.csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv');
    click.mockRestore();
  });

  it('tells the rider to wait when the export is rate limited', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers() });

    render(<MaintenanceExportPanel />);
    fireEvent.click(screen.getByText('Export maintenance history (CSV)'));

    expect(await screen.findByText(/exported recently/i)).toBeInTheDocument();
  });

  it('reads the filename out of a Content-Disposition header', () => {
    expect(filenameFromDisposition('attachment; filename="a-b.csv"')).toBe('a-b.csv');
    expect(filenameFromDisposition('attachment; filename=plain.csv')).toBe('plain.csv');
    expect(filenameFromDisposition(null)).toBeNull();
  });
});
