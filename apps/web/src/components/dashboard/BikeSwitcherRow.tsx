import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FaPlus, FaGripHorizontal, FaSpinner } from 'react-icons/fa';
import { useMutation } from '@apollo/client';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import { SortableBikeTile } from './SortableBikeTile';
import { UPDATE_BIKES_ORDER, BIKES } from '../../graphql/bikes';

const HINT_DISMISSED_KEY = 'loam-bike-reorder-hint-dismissed';

interface BikeSwitcherRowProps {
  bikes: BikeWithPredictions[];
  selectedBikeId: string | null;
  onSelect: (bikeId: string) => void;
  maxVisible?: number;
}

export function BikeSwitcherRow({
  bikes,
  selectedBikeId,
  onSelect,
  maxVisible = 8,
}: BikeSwitcherRowProps) {
  const [showHint, setShowHint] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [updateBikesOrder] = useMutation(UPDATE_BIKES_ORDER, {
    refetchQueries: [{ query: BIKES }],
  });

  // Check if hint should be shown (only once per user)
  useEffect(() => {
    const dismissed = localStorage.getItem(HINT_DISMISSED_KEY);
    if (!dismissed && bikes.length > 1) {
      setShowHint(true);
    }
  }, [bikes.length]);

  const dismissHint = () => {
    setShowHint(false);
    localStorage.setItem(HINT_DISMISSED_KEY, 'true');
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px of movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (bikes.length <= 1) {
    return null;
  }

  const visibleBikes = bikes.slice(0, maxVisible);
  const hasMore = bikes.length > maxVisible;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = bikes.findIndex((bike) => bike.id === active.id);
      const newIndex = bikes.findIndex((bike) => bike.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(bikes, oldIndex, newIndex);
        const bikeIds = newOrder.map((bike) => bike.id);

        setIsReordering(true);
        try {
          await updateBikesOrder({ variables: { bikeIds } });
        } catch (error) {
          console.error('Failed to update bike order:', error);
        } finally {
          setIsReordering(false);
        }
      }
    }
  };

  // Disable sensors while reordering
  const activeSensors = isReordering ? [] : sensors;

  return (
    <div className="bike-switcher-container">
      {showHint && (
        <div className="bike-switcher-hint">
          <FaGripHorizontal className="bike-switcher-hint-icon" />
          <span>Drag to reorder your bikes</span>
          <button
            className="bike-switcher-hint-dismiss"
            onClick={dismissHint}
            aria-label="Dismiss hint"
          >
            Got it
          </button>
        </div>
      )}
      <DndContext
        sensors={activeSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleBikes.map((bike) => bike.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className={`bike-switcher-row ${isReordering ? 'bike-switcher-row-loading' : ''}`}>
            {isReordering && (
              <div className="bike-switcher-loading-overlay">
                <FaSpinner className="bike-switcher-spinner" />
              </div>
            )}
            {visibleBikes.map((bike) => (
              <SortableBikeTile
                key={bike.id}
                bike={bike}
                isSelected={bike.id === selectedBikeId}
                onClick={() => onSelect(bike.id)}
                disabled={isReordering}
              />
            ))}
            {hasMore && (
              <Link to="/gear" className="bike-tile-more">
                <FaPlus className="bike-tile-more-icon" />
                <span className="bike-tile-more-text">
                  +{bikes.length - maxVisible} more
                </span>
              </Link>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
