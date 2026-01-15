import { useMemo, useState, useEffect } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import type { SpokesImage } from '@/hooks/useSpokes';
import { isValidImageUrl } from '@/utils/bikeFormHelpers';

interface BikeImageSelectorProps {
  images: SpokesImage[];
  thumbnailUrl?: string | null;
  selectedUrl: string | null;
  onSelect: (url: string) => void;
}

/**
 * Carousel-style image selector for choosing bike colorways from 99Spokes.
 * Shows one large image with left/right arrows and dot indicators.
 */
export function BikeImageSelector({
  images,
  thumbnailUrl,
  selectedUrl,
  onSelect,
}: BikeImageSelectorProps) {
  // Combine thumbnailUrl and images array, deduplicate by URL
  const allImages = useMemo(() => {
    const urls = new Set<string>();
    const result: SpokesImage[] = [];

    // Add images from the array first (prioritized per user request)
    images.forEach((img) => {
      if (img.url && isValidImageUrl(img.url) && !urls.has(img.url)) {
        urls.add(img.url);
        result.push(img);
      }
    });

    // Add thumbnailUrl as fallback if not already included
    if (thumbnailUrl && isValidImageUrl(thumbnailUrl) && !urls.has(thumbnailUrl)) {
      urls.add(thumbnailUrl);
      result.push({ url: thumbnailUrl, colorKey: 'Default' });
    }

    return result;
  }, [images, thumbnailUrl]);

  // Find current index based on selectedUrl
  const selectedIndex = useMemo(() => {
    const idx = allImages.findIndex((img) => img.url === selectedUrl);
    return idx >= 0 ? idx : 0;
  }, [allImages, selectedUrl]);

  const [currentIndex, setCurrentIndex] = useState(selectedIndex);

  // Sync currentIndex when selectedUrl changes externally
  useEffect(() => {
    setCurrentIndex(selectedIndex);
  }, [selectedIndex]);

  // Don't render if only 0-1 images available
  if (allImages.length <= 1) return null;

  const currentImage = allImages[currentIndex];

  const goToPrevious = () => {
    const newIndex = currentIndex === 0 ? allImages.length - 1 : currentIndex - 1;
    setCurrentIndex(newIndex);
    onSelect(allImages[newIndex].url);
  };

  const goToNext = () => {
    const newIndex = currentIndex === allImages.length - 1 ? 0 : currentIndex + 1;
    setCurrentIndex(newIndex);
    onSelect(allImages[newIndex].url);
  };

  const goToIndex = (index: number) => {
    setCurrentIndex(index);
    onSelect(allImages[index].url);
  };

  return (
    <div className="space-y-4">
      {/* Main image with arrows */}
      <div className="relative">
        {/* Left arrow */}
        <button
          type="button"
          onClick={goToPrevious}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          aria-label="Previous image"
        >
          <FaChevronLeft size={20} />
        </button>

        {/* Image container */}
        <div className="aspect-[4/3] bg-white/5 rounded-xl overflow-hidden flex items-center justify-center">
          <img
            src={currentImage.url}
            alt={currentImage.colorKey || `Colorway ${currentIndex + 1}`}
            className="max-w-full max-h-full object-contain"
            onError={(e) => {
              e.currentTarget.style.opacity = '0.3';
            }}
          />
        </div>

        {/* Right arrow */}
        <button
          type="button"
          onClick={goToNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          aria-label="Next image"
        >
          <FaChevronRight size={20} />
        </button>
      </div>

      {/* Color name */}
      {currentImage.colorKey && (
        <p className="text-center text-lg font-medium text-heading">
          {currentImage.colorKey}
        </p>
      )}

      {/* Dot indicators */}
      <div className="flex justify-center gap-2">
        {allImages.map((img, idx) => (
          <button
            key={img.url}
            type="button"
            onClick={() => goToIndex(idx)}
            className={`
              w-2.5 h-2.5 rounded-full transition-all
              ${idx === currentIndex
                ? 'bg-accent scale-125'
                : 'bg-white/30 hover:bg-white/50'
              }
            `}
            aria-label={`Go to colorway ${idx + 1}${img.colorKey ? `: ${img.colorKey}` : ''}`}
          />
        ))}
      </div>

      {/* Counter */}
      <p className="text-center text-sm text-muted">
        {currentIndex + 1} of {allImages.length} colorways
      </p>
    </div>
  );
}
