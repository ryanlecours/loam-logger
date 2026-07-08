import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminTable, type AdminTableColumn } from './AdminTable';

const columns: AdminTableColumn[] = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta', align: 'right' },
];

describe('AdminTable', () => {
  it('renders header labels for each column', () => {
    render(
      <AdminTable columns={columns} rowCount={1}>
        <tr>
          <td>1</td>
          <td>2</td>
        </tr>
      </AdminTable>,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders the row body passed via children', () => {
    render(
      <AdminTable columns={columns} rowCount={1}>
        <tr>
          <td>cell-a</td>
          <td>cell-b</td>
        </tr>
      </AdminTable>,
    );
    expect(screen.getByText('cell-a')).toBeInTheDocument();
    expect(screen.getByText('cell-b')).toBeInTheDocument();
  });

  it('shows the empty state when rowCount is 0 and not loading', () => {
    render(
      <AdminTable
        columns={columns}
        rowCount={0}
        empty={<span>Nothing here</span>}
      >
        {null}
      </AdminTable>,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    // Spinner has role="status"; should NOT be present in the empty state.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the loading spinner instead of the empty state while loading', () => {
    // While the first page is loading, an empty `rowCount` is meaningless —
    // we don't yet know if the table is genuinely empty. Suppress the empty
    // state until loading completes so admins don't briefly see "No X yet."
    // before data lands.
    render(
      <AdminTable
        columns={columns}
        rowCount={0}
        loading
        empty="No entries"
      >
        {null}
      </AdminTable>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('No entries')).not.toBeInTheDocument();
  });

  it('renders a default empty message when none is supplied', () => {
    render(
      <AdminTable columns={columns} rowCount={0}>
        {null}
      </AdminTable>,
    );
    expect(screen.getByText('No entries yet.')).toBeInTheDocument();
  });

  it('renders the loadMore slot when provided and not loading', () => {
    render(
      <AdminTable
        columns={columns}
        rowCount={1}
        loadMore={<button>Load More</button>}
      >
        <tr>
          <td>x</td>
          <td>y</td>
        </tr>
      </AdminTable>,
    );
    expect(screen.getByRole('button', { name: 'Load More' })).toBeInTheDocument();
  });

  it('hides loadMore while loading (avoids double-tap during page fetch)', () => {
    render(
      <AdminTable
        columns={columns}
        rowCount={1}
        loading
        loadMore={<button>Load More</button>}
      >
        <tr>
          <td>x</td>
          <td>y</td>
        </tr>
      </AdminTable>,
    );
    expect(screen.queryByRole('button', { name: 'Load More' })).not.toBeInTheDocument();
  });

  it('right-aligns columns marked align="right"', () => {
    render(
      <AdminTable columns={columns} rowCount={1}>
        <tr>
          <td>x</td>
          <td>y</td>
        </tr>
      </AdminTable>,
    );
    const betaHeader = screen.getByText('Beta');
    expect(betaHeader.className).toContain('text-right');
  });
});
