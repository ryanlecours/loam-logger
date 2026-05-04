import type { ReactNode } from 'react';

export type AdminTableColumn = {
  key: string;
  label: ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Optional fixed width applied via inline style on `<th>` and matching `<td>`s. */
  width?: string;
  /** Class applied to header cell only (e.g. `'sr-only'` for hidden labels). */
  headerClassName?: string;
};

type Props = {
  columns: AdminTableColumn[];
  /** Total row count after filtering, used to drive the empty state. */
  rowCount: number;
  loading?: boolean;
  empty?: ReactNode;
  loadMore?: ReactNode;
  children: ReactNode;
};

/**
 * Shared table wrapper used by every admin section. Centralizes the column
 * header styling, hover row treatment, loading spinner, and empty state so
 * each section stops re-implementing its own raw `<table>` + spinner +
 * "No X yet." line. Section components own the `<tr>` rows themselves.
 */
export function AdminTable({
  columns,
  rowCount,
  loading,
  empty,
  loadMore,
  children,
}: Props) {
  const alignClass = (align: AdminTableColumn['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-app/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={[
                    'py-3 px-4 text-muted font-medium',
                    alignClass(col.align),
                    col.headerClassName ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <div
            className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
            role="status"
            aria-label="Loading"
          />
        </div>
      )}

      {!loading && rowCount === 0 && (
        <div className="text-center text-muted py-8">{empty ?? 'No entries yet.'}</div>
      )}

      {!loading && loadMore && <div className="flex justify-center">{loadMore}</div>}
    </>
  );
}
