import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimeframeDropdown from './TimeframeDropdown';
import type { Timeframe } from './types';

describe('TimeframeDropdown', () => {
  const defaultProps = {
    selected: 'YTD' as Timeframe,
    onSelect: vi.fn(),
  };

  describe('rendering preset options', () => {
    it('renders all preset timeframe options', () => {
      render(<TimeframeDropdown {...defaultProps} />);

      expect(screen.getByRole('option', { name: 'Last 7 Days' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Last 30 Days' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Last 90 Days' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Year to Date' })).toBeInTheDocument();
    });

    it('does not include All Time option', () => {
      render(<TimeframeDropdown {...defaultProps} />);

      expect(screen.queryByRole('option', { name: 'All Time' })).not.toBeInTheDocument();
    });

    it('shows selected preset as current value', () => {
      render(<TimeframeDropdown {...defaultProps} selected="1m" />);

      const select = screen.getByRole('combobox');
      expect(select).toHaveValue('1m');
    });
  });

  describe('year options', () => {
    it('renders available years when provided', () => {
      render(
        <TimeframeDropdown
          {...defaultProps}
          availableYears={[2023, 2022, 2021]}
        />
      );

      expect(screen.getByRole('option', { name: '2023' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: '2022' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: '2021' })).toBeInTheDocument();
    });

    it('renders separator before years when years are available', () => {
      render(
        <TimeframeDropdown
          {...defaultProps}
          availableYears={[2023]}
        />
      );

      // The separator is a disabled option with dashes
      const options = screen.getAllByRole('option');
      const separatorOption = options.find(opt => opt.textContent?.includes('─'));
      expect(separatorOption).toBeInTheDocument();
      expect(separatorOption).toBeDisabled();
    });

    it('does not render separator when no years available', () => {
      render(<TimeframeDropdown {...defaultProps} availableYears={[]} />);

      const options = screen.getAllByRole('option');
      const separatorOption = options.find(opt => opt.textContent?.includes('─'));
      expect(separatorOption).toBeUndefined();
    });

    it('shows selected year as current value', () => {
      render(
        <TimeframeDropdown
          {...defaultProps}
          selected={2023}
          availableYears={[2023, 2022]}
        />
      );

      const select = screen.getByRole('combobox');
      expect(select).toHaveValue('2023');
    });
  });

  describe('selection handling', () => {
    it('calls onSelect with preset value when preset selected', () => {
      const onSelect = vi.fn();
      render(<TimeframeDropdown {...defaultProps} onSelect={onSelect} />);

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: '1w' } });

      expect(onSelect).toHaveBeenCalledWith('1w');
    });

    it('calls onSelect with number when year selected', () => {
      const onSelect = vi.fn();
      render(
        <TimeframeDropdown
          {...defaultProps}
          onSelect={onSelect}
          availableYears={[2023, 2022]}
        />
      );

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: '2023' } });

      expect(onSelect).toHaveBeenCalledWith(2023);
    });

    it('correctly distinguishes between preset and year values', () => {
      const onSelect = vi.fn();
      render(
        <TimeframeDropdown
          {...defaultProps}
          onSelect={onSelect}
          availableYears={[2023]}
        />
      );

      const select = screen.getByRole('combobox');

      // Select a preset
      fireEvent.change(select, { target: { value: '3m' } });
      expect(onSelect).toHaveBeenLastCalledWith('3m');

      // Select a year
      fireEvent.change(select, { target: { value: '2023' } });
      expect(onSelect).toHaveBeenLastCalledWith(2023);
    });
  });

  describe('edge cases', () => {
    it('handles empty availableYears array', () => {
      render(<TimeframeDropdown {...defaultProps} availableYears={[]} />);

      // Should only have 4 preset options
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(4);
    });

    it('handles undefined availableYears', () => {
      render(<TimeframeDropdown {...defaultProps} />);

      // Should only have 4 preset options
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(4);
    });

    it('renders years in provided order', () => {
      render(
        <TimeframeDropdown
          {...defaultProps}
          availableYears={[2021, 2023, 2022]}
        />
      );

      const yearOptions = screen.getAllByRole('option').filter(
        opt => /^\d{4}$/.test(opt.textContent ?? '')
      );

      expect(yearOptions[0]).toHaveTextContent('2021');
      expect(yearOptions[1]).toHaveTextContent('2023');
      expect(yearOptions[2]).toHaveTextContent('2022');
    });
  });
});
