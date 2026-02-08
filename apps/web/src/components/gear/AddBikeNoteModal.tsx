import { useState, useCallback, useEffect } from 'react';
import { useMutation } from '@apollo/client';
import { FaExclamationTriangle } from 'react-icons/fa';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ADD_BIKE_NOTE, BIKE_NOTES_QUERY } from '../../graphql/gear';

interface AddBikeNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  bikeId: string;
  bikeName: string;
}

const MAX_NOTE_LENGTH = 2000;

export function AddBikeNoteModal({
  isOpen,
  onClose,
  bikeId,
  bikeName,
}: AddBikeNoteModalProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [addBikeNote, { loading: mutating }] = useMutation(ADD_BIKE_NOTE, {
    refetchQueries: [
      { query: BIKE_NOTES_QUERY, variables: { bikeId, take: 10 } },
    ],
    awaitRefetchQueries: true,
  });

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setText('');
      setError(null);
    }
  }, [isOpen]);

  const canSave = text.trim().length > 0 && text.length <= MAX_NOTE_LENGTH;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setError(null);

    try {
      await addBikeNote({
        variables: {
          input: {
            bikeId,
            text: text.trim(),
          },
        },
      });
      onClose();
    } catch (err) {
      console.error('Failed to add note:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to add note. Please try again.'
      );
    }
  }, [addBikeNote, bikeId, canSave, onClose, text]);

  const handleClose = useCallback(() => {
    if (!mutating) {
      onClose();
    }
  }, [mutating, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Note"
      subtitle={`Add a note to ${bikeName}`}
      size="md"
      preventClose={mutating}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={mutating}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!canSave || mutating}
          >
            {mutating ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="note-text"
            className="text-xs font-medium text-muted"
          >
            Note
          </label>
          <textarea
            id="note-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a note about this bike's setup, maintenance, or any other details you want to remember..."
            rows={4}
            maxLength={MAX_NOTE_LENGTH}
            className="rounded-md border border-app bg-surface px-3 py-2 text-sm text-app placeholder:text-muted focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest resize-none"
            autoFocus
          />
          <div className="flex justify-between text-xs text-muted">
            <span>
              {text.length > MAX_NOTE_LENGTH && (
                <span className="text-red-400">Note is too long</span>
              )}
            </span>
            <span className={text.length > MAX_NOTE_LENGTH ? 'text-red-400' : ''}>
              {text.length}/{MAX_NOTE_LENGTH}
            </span>
          </div>
        </div>

        <div className="rounded-md border border-app bg-surface-2 px-3 py-2 text-xs text-muted">
          A snapshot of your bike's current setup will be saved with this note.
        </div>

        {/* Error */}
        {error && (
          <div className="alert-inline alert-inline-error">
            <FaExclamationTriangle size={14} />
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
