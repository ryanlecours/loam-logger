import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FaChevronDown, FaTrash, FaExchangeAlt, FaStickyNote } from 'react-icons/fa';
import type { SetupSnapshot } from '@loam/shared';
import { SetupSnapshotView } from './SetupSnapshotView';

export interface BikeNote {
  id: string;
  bikeId: string;
  userId: string;
  text: string;
  noteType: 'MANUAL' | 'SWAP';
  createdAt: string;
  snapshot?: SetupSnapshot | null;
  snapshotBefore?: SetupSnapshot | null;
  snapshotAfter?: SetupSnapshot | null;
  installEventId?: string | null;
}

interface BikeNoteCardProps {
  note: BikeNote;
  onDelete?: (id: string) => void;
  deleting?: boolean;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function BikeNoteCard({ note, onDelete, deleting }: BikeNoteCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeSnapshotView, setActiveSnapshotView] = useState<'before' | 'after'>('after');

  const hasSnapshot = note.snapshot || note.snapshotBefore || note.snapshotAfter;
  const isSwapNote = note.noteType === 'SWAP';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="rounded-lg border border-app bg-surface overflow-hidden">
      {/* Header - clickable to expand */}
      <div
        className={`flex items-start gap-3 px-4 py-3 ${hasSnapshot ? 'cursor-pointer hover:bg-surface-2' : ''}`}
        onClick={() => hasSnapshot && setIsExpanded(!isExpanded)}
        onKeyDown={hasSnapshot ? handleKeyDown : undefined}
        role={hasSnapshot ? 'button' : undefined}
        tabIndex={hasSnapshot ? 0 : undefined}
        aria-expanded={hasSnapshot ? isExpanded : undefined}
      >
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {isSwapNote ? (
            <FaExchangeAlt className="text-forest" size={14} />
          ) : (
            <FaStickyNote className="text-muted" size={14} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
                isSwapNote
                  ? 'bg-forest/20 text-forest'
                  : 'bg-surface-2 text-muted'
              }`}
            >
              {isSwapNote ? 'Component Change' : 'Note'}
            </span>
            <span className="text-xs text-muted">{formatDate(note.createdAt)}</span>
          </div>
          <p className="text-sm text-app whitespace-pre-wrap">{note.text}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {onDelete && (
            <button
              type="button"
              className="p-1.5 text-muted hover:text-red-400 transition-colors rounded hover:bg-surface-2"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(note.id);
              }}
              disabled={deleting}
              aria-label="Delete note"
            >
              <FaTrash size={12} />
            </button>
          )}
          {hasSnapshot && (
            <FaChevronDown
              size={12}
              className={`text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          )}
        </div>
      </div>

      {/* Expanded snapshot view */}
      <AnimatePresence>
        {isExpanded && hasSnapshot && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-app pt-3">
              {/* Before/After toggle for SWAP notes */}
              {isSwapNote && note.snapshotBefore && note.snapshotAfter && (
                <div className="flex gap-1 rounded-lg bg-surface-2 p-1 mb-3">
                  <button
                    type="button"
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      activeSnapshotView === 'before'
                        ? 'bg-surface text-app shadow-sm'
                        : 'text-muted hover:text-app'
                    }`}
                    onClick={() => setActiveSnapshotView('before')}
                  >
                    Before
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      activeSnapshotView === 'after'
                        ? 'bg-surface text-app shadow-sm'
                        : 'text-muted hover:text-app'
                    }`}
                    onClick={() => setActiveSnapshotView('after')}
                  >
                    After
                  </button>
                </div>
              )}

              {/* Snapshot content */}
              {isSwapNote ? (
                activeSnapshotView === 'before' && note.snapshotBefore ? (
                  <SetupSnapshotView snapshot={note.snapshotBefore} compact />
                ) : note.snapshotAfter ? (
                  <SetupSnapshotView snapshot={note.snapshotAfter} compact />
                ) : null
              ) : note.snapshot ? (
                <SetupSnapshotView snapshot={note.snapshot} compact />
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
