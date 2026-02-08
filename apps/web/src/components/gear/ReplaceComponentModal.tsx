import { useState, useCallback, useEffect, useMemo } from 'react';
import { useMutation } from '@apollo/client';
import { FaExclamationTriangle, FaExchangeAlt } from 'react-icons/fa';
import { getSlotKey } from '@loam/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { INSTALL_COMPONENT, GEAR_QUERY_LIGHT } from '../../graphql/gear';
import { getComponentLabel } from '../../constants/componentLabels';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplaceComponentModalProps {
  isOpen: boolean;
  onClose: () => void;
  bikeId: string;
  bikeName: string;
  component: {
    id: string;
    type: string;
    location?: string | null;
    brand: string;
    model: string;
  };
  spareComponents: Array<{
    id: string;
    type: string;
    location?: string | null;
    brand: string;
    model: string;
    hoursUsed?: number | null;
    isStock: boolean;
  }>;
  hasMultipleBikes: boolean;
  onSwapInstead?: () => void;
}

type Tab = 'spare' | 'new';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReplaceComponentModal({
  isOpen,
  onClose,
  bikeId,
  bikeName,
  component,
  spareComponents,
  hasMultipleBikes,
  onSwapInstead,
}: ReplaceComponentModalProps) {
  // ---- local state --------------------------------------------------------
  const [activeTab, setActiveTab] = useState<Tab>('spare');
  const [selectedSpareId, setSelectedSpareId] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState('');
  const [newModel, setNewModel] = useState('');
  const [noteText, setNoteText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ---- derived ------------------------------------------------------------
  const slotKey = useMemo(
    () => getSlotKey(component.type, component.location || 'NONE'),
    [component.type, component.location],
  );

  const matchingSpares = useMemo(
    () => spareComponents.filter((s) => s.type === component.type),
    [spareComponents, component.type],
  );

  const typeLabel = getComponentLabel(component.type);

  // ---- mutation ------------------------------------------------------------
  const [installComponent, { loading: mutating }] = useMutation(INSTALL_COMPONENT, {
    refetchQueries: [{ query: GEAR_QUERY_LIGHT }],
    awaitRefetchQueries: true,
  });

  // ---- reset state when modal opens / closes ------------------------------
  useEffect(() => {
    if (isOpen) {
      setActiveTab(matchingSpares.length > 0 ? 'spare' : 'new');
      setSelectedSpareId(null);
      setNewBrand('');
      setNewModel('');
      setNoteText('');
      setError(null);
    }
  }, [isOpen, matchingSpares.length]);

  // ---- handlers -----------------------------------------------------------
  const canConfirm =
    activeTab === 'spare'
      ? selectedSpareId !== null
      : newBrand.trim() !== '' && newModel.trim() !== '';

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return;
    setError(null);

    try {
      const trimmedNoteText = noteText.trim() || null;

      if (activeTab === 'spare') {
        await installComponent({
          variables: {
            input: {
              bikeId,
              slotKey,
              existingComponentId: selectedSpareId,
              noteText: trimmedNoteText,
            },
          },
        });
      } else {
        await installComponent({
          variables: {
            input: {
              bikeId,
              slotKey,
              newComponent: {
                brand: newBrand.trim(),
                model: newModel.trim(),
              },
              noteText: trimmedNoteText,
            },
          },
        });
      }

      onClose();
    } catch (err) {
      console.error('Failed to replace component:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to replace component. Please try again.',
      );
    }
  }, [
    activeTab,
    bikeId,
    canConfirm,
    installComponent,
    newBrand,
    newModel,
    noteText,
    onClose,
    selectedSpareId,
    slotKey,
  ]);

  const handleClose = useCallback(() => {
    if (!mutating) {
      setError(null);
      onClose();
    }
  }, [mutating, onClose]);

  // ---- render -------------------------------------------------------------
  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Replace Component"
      subtitle={`Replace ${component.brand} ${component.model} on ${bikeName}`}
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
            onClick={handleConfirm}
            disabled={!canConfirm || mutating}
          >
            {mutating ? 'Replacing...' : 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Compatibility warning */}
        <div className="flex items-start gap-2 rounded-md border border-app bg-surface-2 px-3 py-2 text-sm text-muted">
          <FaExclamationTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          <span>
            Compatibility is not validated. Ensure the replacement fits your bike.
          </span>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === 'spare'
                ? 'bg-surface text-app shadow-sm'
                : 'text-muted hover:text-app'
            }`}
            onClick={() => setActiveTab('spare')}
          >
            Use spare
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === 'new'
                ? 'bg-surface text-app shadow-sm'
                : 'text-muted hover:text-app'
            }`}
            onClick={() => setActiveTab('new')}
          >
            New component
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'spare' ? (
          <div className="flex flex-col gap-2">
            {matchingSpares.length === 0 ? (
              <div className="rounded-md border border-app bg-surface-2 px-4 py-6 text-center">
                <p className="text-sm text-muted">
                  No spare {typeLabel.toLowerCase()} components in your inventory.
                </p>
                <p className="mt-1 text-xs text-muted">
                  Add one from the Garage page to use it here.
                </p>
              </div>
            ) : (
              matchingSpares.map((spare) => {
                const isSelected = selectedSpareId === spare.id;
                return (
                  <button
                    key={spare.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'border-forest bg-forest/10 text-app'
                        : 'border-app bg-surface hover:bg-surface-2'
                    }`}
                    onClick={() => setSelectedSpareId(spare.id)}
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        isSelected
                          ? 'border-forest bg-forest'
                          : 'border-app bg-surface'
                      }`}
                    >
                      {isSelected && (
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-app">
                        {spare.isStock
                          ? 'Stock spec'
                          : `${spare.brand} ${spare.model}`}
                      </p>
                      <p className="text-xs text-muted">
                        {spare.hoursUsed ?? 0}h used
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="replace-brand"
                className="text-xs font-medium text-muted"
              >
                Brand
              </label>
              <input
                id="replace-brand"
                type="text"
                value={newBrand}
                onChange={(e) => setNewBrand(e.target.value)}
                placeholder="e.g. Fox, RockShox, Shimano"
                className="rounded-md border border-app bg-surface px-3 py-2 text-sm text-app placeholder:text-muted focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="replace-model"
                className="text-xs font-medium text-muted"
              >
                Model
              </label>
              <input
                id="replace-model"
                type="text"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                placeholder="e.g. 36 Factory, Pike Ultimate"
                className="rounded-md border border-app bg-surface px-3 py-2 text-sm text-app placeholder:text-muted focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest"
              />
            </div>
          </div>
        )}

        {/* Note textarea */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="replace-note"
            className="text-xs font-medium text-muted"
          >
            Note (optional)
          </label>
          <textarea
            id="replace-note"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Why are you making this change?"
            rows={2}
            maxLength={2000}
            className="rounded-md border border-app bg-surface px-3 py-2 text-sm text-app placeholder:text-muted focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest resize-none"
          />
          {noteText.length > 0 && (
            <span className="text-xs text-muted text-right">
              {noteText.length}/2000
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="alert-inline alert-inline-error">
            <FaExclamationTriangle size={14} />
            {error}
          </div>
        )}

        {/* Swap with another bike link */}
        {hasMultipleBikes && onSwapInstead && (
          <div className="border-t border-app pt-3 text-center">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-app"
              onClick={onSwapInstead}
            >
              <FaExchangeAlt size={12} />
              Or swap with another bike
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
