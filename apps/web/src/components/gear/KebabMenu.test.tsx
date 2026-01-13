import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KebabMenu, type KebabMenuItem } from './KebabMenu';

describe('KebabMenu', () => {
  const defaultItems: KebabMenuItem[] = [
    { label: 'Edit', onClick: vi.fn() },
    { label: 'Delete', onClick: vi.fn(), danger: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders trigger button with default aria-label', () => {
      render(<KebabMenu items={defaultItems} />);

      expect(screen.getByRole('button', { name: 'Actions menu' })).toBeInTheDocument();
    });

    it('renders trigger button with custom aria-label', () => {
      render(<KebabMenu items={defaultItems} ariaLabel="Bike actions" />);

      expect(screen.getByRole('button', { name: 'Bike actions' })).toBeInTheDocument();
    });

    it('menu is closed by default', () => {
      render(<KebabMenu items={defaultItems} />);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('has correct aria attributes when closed', () => {
      render(<KebabMenu items={defaultItems} />);

      const trigger = screen.getByRole('button');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    });
  });

  describe('opening and closing', () => {
    it('opens menu on trigger click', () => {
      render(<KebabMenu items={defaultItems} />);

      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes menu on second trigger click', () => {
      render(<KebabMenu items={defaultItems} />);

      const trigger = screen.getByRole('button');
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.click(trigger);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes menu on Escape key', () => {
      render(<KebabMenu items={defaultItems} />);

      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('returns focus to trigger on Escape', () => {
      render(<KebabMenu items={defaultItems} />);

      const trigger = screen.getByRole('button');
      fireEvent.click(trigger);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(document.activeElement).toBe(trigger);
    });

    it('closes menu on click outside', () => {
      render(
        <div>
          <KebabMenu items={defaultItems} />
          <button data-testid="outside">Outside</button>
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Actions menu' }));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('does not close menu on click inside menu', () => {
      render(<KebabMenu items={defaultItems} />);

      fireEvent.click(screen.getByRole('button'));
      const menu = screen.getByRole('menu');

      fireEvent.mouseDown(menu);
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
  });

  describe('menu items', () => {
    it('renders all menu items', () => {
      render(<KebabMenu items={defaultItems} />);

      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('applies danger class to danger items', () => {
      render(<KebabMenu items={defaultItems} />);

      fireEvent.click(screen.getByRole('button'));

      const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
      expect(deleteItem).toHaveClass('kebab-menu-item-danger');
    });

    it('does not apply danger class to non-danger items', () => {
      render(<KebabMenu items={defaultItems} />);

      fireEvent.click(screen.getByRole('button'));

      const editItem = screen.getByRole('menuitem', { name: 'Edit' });
      expect(editItem).not.toHaveClass('kebab-menu-item-danger');
    });

    it('renders item icons when provided', () => {
      const itemsWithIcons: KebabMenuItem[] = [
        { label: 'Edit', onClick: vi.fn(), icon: <span data-testid="edit-icon">E</span> },
      ];

      render(<KebabMenu items={itemsWithIcons} />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByTestId('edit-icon')).toBeInTheDocument();
    });

    it('applies disabled class to disabled items', () => {
      const itemsWithDisabled: KebabMenuItem[] = [
        { label: 'Edit', onClick: vi.fn() },
        { label: 'Delete', onClick: vi.fn(), disabled: true },
      ];

      render(<KebabMenu items={itemsWithDisabled} />);
      fireEvent.click(screen.getByRole('button'));

      const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
      expect(deleteItem).toBeDisabled();
      expect(deleteItem).toHaveClass('kebab-menu-item-disabled');
    });

    it('does not call onClick for disabled items', () => {
      const onClickSpy = vi.fn();
      const itemsWithDisabled: KebabMenuItem[] = [
        { label: 'Delete', onClick: onClickSpy, disabled: true },
      ];

      render(<KebabMenu items={itemsWithDisabled} />);
      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

      expect(onClickSpy).not.toHaveBeenCalled();
    });
  });

  describe('item click behavior', () => {
    it('calls onClick handler when item clicked', () => {
      const onEdit = vi.fn();
      const items: KebabMenuItem[] = [{ label: 'Edit', onClick: onEdit }];

      render(<KebabMenu items={items} />);
      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('closes menu after item click', () => {
      render(<KebabMenu items={defaultItems} />);

      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('cleanup', () => {
    it('removes event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const { unmount } = render(<KebabMenu items={defaultItems} />);
      fireEvent.click(screen.getByRole('button'));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });
  });
});
