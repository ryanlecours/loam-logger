import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BikeImageSelector } from './BikeImageSelector';
import type { SpokesImage } from '@/hooks/useSpokes';

describe('BikeImageSelector', () => {
  const createImages = (count: number): SpokesImage[] =>
    Array.from({ length: count }, (_, i) => ({
      url: `https://example.com/image${i + 1}.jpg`,
      colorKey: `Color ${i + 1}`,
    }));

  describe('rendering', () => {
    it('does not render when 0 images available', () => {
      const onSelect = vi.fn();
      const { container } = render(
        <BikeImageSelector
          images={[]}
          thumbnailUrl={null}
          selectedUrl={null}
          onSelect={onSelect}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('does not render when only 1 image available', () => {
      const onSelect = vi.fn();
      const { container } = render(
        <BikeImageSelector
          images={createImages(1)}
          thumbnailUrl={null}
          selectedUrl={createImages(1)[0].url}
          onSelect={onSelect}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders carousel with multiple images', () => {
      const images = createImages(3);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      // Should show navigation arrows
      expect(screen.getByLabelText('Previous image')).toBeInTheDocument();
      expect(screen.getByLabelText('Next image')).toBeInTheDocument();

      // Should show dot indicators for each image
      expect(screen.getByLabelText('Go to colorway 1: Color 1')).toBeInTheDocument();
      expect(screen.getByLabelText('Go to colorway 2: Color 2')).toBeInTheDocument();
      expect(screen.getByLabelText('Go to colorway 3: Color 3')).toBeInTheDocument();

      // Should show counter
      expect(screen.getByText('1 of 3 colorways')).toBeInTheDocument();

      // Should show color name
      expect(screen.getByText('Color 1')).toBeInTheDocument();
    });

    it('deduplicates images by URL', () => {
      const images: SpokesImage[] = [
        { url: 'https://example.com/image1.jpg', colorKey: 'Red' },
        { url: 'https://example.com/image1.jpg', colorKey: 'Red Duplicate' },
        { url: 'https://example.com/image2.jpg', colorKey: 'Blue' },
      ];
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      // Should only show 2 colorways (deduped)
      expect(screen.getByText('1 of 2 colorways')).toBeInTheDocument();
    });

    it('includes thumbnailUrl as fallback if not already in images', () => {
      const images = createImages(2);
      const thumbnailUrl = 'https://example.com/thumbnail.jpg';
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={thumbnailUrl}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      // Should show 3 colorways (2 images + 1 thumbnail)
      expect(screen.getByText('1 of 3 colorways')).toBeInTheDocument();
    });

    it('does not duplicate thumbnailUrl if already in images', () => {
      const images = createImages(2);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={images[0].url}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      // Should still show 2 colorways (thumbnail already in images)
      expect(screen.getByText('1 of 2 colorways')).toBeInTheDocument();
    });

    it('filters out invalid image URLs', () => {
      const images: SpokesImage[] = [
        { url: 'https://example.com/valid.jpg', colorKey: 'Valid' },
        { url: 'not-a-url', colorKey: 'Invalid' },
        { url: 'https://example.com/valid2.jpg', colorKey: 'Also Valid' },
      ];
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      // Should only show 2 colorways (invalid URL filtered)
      expect(screen.getByText('1 of 2 colorways')).toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('navigates to next image on right arrow click', async () => {
      const user = userEvent.setup();
      const images = createImages(3);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      await user.click(screen.getByLabelText('Next image'));

      expect(onSelect).toHaveBeenCalledWith(images[1].url);
    });

    it('navigates to previous image on left arrow click', async () => {
      const user = userEvent.setup();
      const images = createImages(3);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[1].url}
          onSelect={onSelect}
        />
      );

      await user.click(screen.getByLabelText('Previous image'));

      expect(onSelect).toHaveBeenCalledWith(images[0].url);
    });

    it('wraps to last image when clicking previous on first image', async () => {
      const user = userEvent.setup();
      const images = createImages(3);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      await user.click(screen.getByLabelText('Previous image'));

      expect(onSelect).toHaveBeenCalledWith(images[2].url);
    });

    it('wraps to first image when clicking next on last image', async () => {
      const user = userEvent.setup();
      const images = createImages(3);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[2].url}
          onSelect={onSelect}
        />
      );

      await user.click(screen.getByLabelText('Next image'));

      expect(onSelect).toHaveBeenCalledWith(images[0].url);
    });

    it('selects image on dot click', async () => {
      const user = userEvent.setup();
      const images = createImages(3);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      await user.click(screen.getByLabelText('Go to colorway 3: Color 3'));

      expect(onSelect).toHaveBeenCalledWith(images[2].url);
    });
  });

  describe('selected state', () => {
    it('shows correct image based on selectedUrl', () => {
      const images = createImages(3);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[1].url}
          onSelect={onSelect}
        />
      );

      // Counter should show 2 of 3 (index 1)
      expect(screen.getByText('2 of 3 colorways')).toBeInTheDocument();
      // Color name should be Color 2
      expect(screen.getByText('Color 2')).toBeInTheDocument();
    });

    it('defaults to first image if selectedUrl not found', () => {
      const images = createImages(3);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl="https://example.com/nonexistent.jpg"
          onSelect={onSelect}
        />
      );

      // Should default to first image
      expect(screen.getByText('1 of 3 colorways')).toBeInTheDocument();
      expect(screen.getByText('Color 1')).toBeInTheDocument();
    });
  });

  describe('image error handling', () => {
    it('reduces opacity on image load error', () => {
      const images = createImages(2);
      const onSelect = vi.fn();
      render(
        <BikeImageSelector
          images={images}
          thumbnailUrl={null}
          selectedUrl={images[0].url}
          onSelect={onSelect}
        />
      );

      const img = screen.getByAltText('Color 1') as HTMLImageElement;

      // Simulate image error
      img.dispatchEvent(new Event('error'));

      expect(img.style.opacity).toBe('0.3');
    });
  });
});
