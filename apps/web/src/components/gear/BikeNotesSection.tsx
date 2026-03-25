import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { motion, AnimatePresence } from 'motion/react';
import { FaChevronDown, FaPlus, FaStickyNote } from 'react-icons/fa';
import { BikeNoteCard, type BikeNote } from './BikeNoteCard';
import { BIKE_NOTES_QUERY, DELETE_BIKE_NOTE } from '../../graphql/gear';
import { Button } from '../ui/Button';

interface BikeNotesSectionProps {
  bikeId: string;
  onAddNote: () => void;
}

interface BikeNotesQueryResult {
  bikeNotes: {
    items: BikeNote[];
    totalCount: number;
    hasMore: boolean;
  };
}

export function BikeNotesSection({ bikeId, onAddNote }: BikeNotesSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, loading, error, fetchMore, refetch } = useQuery<BikeNotesQueryResult>(
    BIKE_NOTES_QUERY,
    {
      variables: { bikeId, take: 10 },
      skip: !isExpanded,
      fetchPolicy: 'cache-and-network',
    }
  );

  const [deleteNote] = useMutation(DELETE_BIKE_NOTE, {
    onCompleted: () => {
      refetch();
      setDeletingId(null);
    },
    onError: () => {
      setDeletingId(null);
    },
  });

  const notes = data?.bikeNotes?.items ?? [];
  const totalCount = data?.bikeNotes?.totalCount ?? 0;
  const hasMore = data?.bikeNotes?.hasMore ?? false;

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this note?')) {
      setDeletingId(id);
      await deleteNote({ variables: { id } });
    }
  };

  const handleLoadMore = () => {
    if (notes.length > 0) {
      fetchMore({
        variables: {
          bikeId,
          take: 10,
          after: notes[notes.length - 1].id,
        },
        updateQuery: (prev, { fetchMoreResult }) => {
          if (!fetchMoreResult) return prev;
          return {
            bikeNotes: {
              ...fetchMoreResult.bikeNotes,
              items: [...prev.bikeNotes.items, ...fetchMoreResult.bikeNotes.items],
            },
          };
        },
      });
    }
  };

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="rounded-lg border border-app bg-surface overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition-colors"
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <FaStickyNote className="text-muted" size={14} />
          <span className="text-sm font-medium text-app">Notes</span>
          {totalCount > 0 && (
            <span className="text-xs text-muted">({totalCount})</span>
          )}
        </div>
        <FaChevronDown
          size={12}
          className={`text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-app pt-3">
              {/* Add note button */}
              <div className="mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAddNote}
                  className="w-full"
                >
                  <FaPlus size={10} className="mr-1.5" />
                  Add Note
                </Button>
              </div>

              {/* Loading state */}
              {loading && notes.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted">Loading notes...</p>
                </div>
              )}

              {/* Error state */}
              {error && (
                <div className="py-4 text-center">
                  <p className="text-sm text-red-400">Failed to load notes</p>
                  <button
                    type="button"
                    className="text-sm text-forest hover:underline mt-1"
                    onClick={() => refetch()}
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Empty state */}
              {!loading && !error && notes.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted">No notes yet</p>
                  <p className="text-xs text-muted mt-1">
                    Add notes to track your bike's history and setup changes.
                  </p>
                </div>
              )}

              {/* Notes list */}
              {notes.length > 0 && (
                <div className="flex flex-col gap-3">
                  {notes.map((note) => (
                    <BikeNoteCard
                      key={note.id}
                      note={note}
                      onDelete={handleDelete}
                      deleting={deletingId === note.id}
                    />
                  ))}

                  {/* Load more button */}
                  {hasMore && (
                    <button
                      type="button"
                      className="text-sm text-forest hover:underline text-center py-2"
                      onClick={handleLoadMore}
                      disabled={loading}
                    >
                      {loading ? 'Loading...' : 'Load more'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
