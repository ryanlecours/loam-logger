import { useState, useRef, useEffect, type ReactNode } from 'react';
import { FaEllipsisV } from 'react-icons/fa';

export interface KebabMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface KebabMenuProps {
  items: KebabMenuItem[];
  ariaLabel?: string;
}

export function KebabMenu({ items, ariaLabel = 'Actions menu' }: KebabMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleItemClick = (item: KebabMenuItem) => {
    if (item.disabled) return;
    setIsOpen(false);
    item.onClick();
  };

  return (
    <div className="kebab-menu" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        className="kebab-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <FaEllipsisV size={14} />
      </button>

      {isOpen && (
        <div className="kebab-menu-dropdown" role="menu">
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              className={`kebab-menu-item ${item.danger ? 'kebab-menu-item-danger' : ''} ${item.disabled ? 'kebab-menu-item-disabled' : ''}`}
              onClick={() => handleItemClick(item)}
              role="menuitem"
              disabled={item.disabled}
              aria-disabled={item.disabled}
            >
              {item.icon && <span className="kebab-menu-item-icon">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
