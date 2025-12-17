import type { ReactNode } from 'react';

type BackgroundVariant = 'dark' | 'charcoal' | 'light' | 'cream' | 'gradient-dark';

type Props = {
  children: ReactNode;
  background?: BackgroundVariant;
  className?: string;
  id?: string;
};

const backgroundClasses: Record<BackgroundVariant, string> = {
  dark: 'mkt-bg-dark',
  charcoal: 'mkt-bg-charcoal',
  light: 'mkt-bg-light',
  cream: 'mkt-bg-cream',
  'gradient-dark': 'mkt-bg-gradient-dark',
};

export default function SectionWrapper({
  children,
  background = 'dark',
  className = '',
  id,
}: Props) {
  return (
    <section
      id={id}
      className={`mkt-section mkt-section-padding ${backgroundClasses[background]} ${className}`}
    >
      <div className="mkt-container">
        {children}
      </div>
    </section>
  );
}
