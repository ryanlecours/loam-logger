import type { ReactNode } from 'react';

type BackgroundVariant = 'dark' | 'charcoal' | 'light' | 'cream' | 'gradient-dark';

type Props = {
  children: ReactNode;
  background?: BackgroundVariant;
  className?: string;
  id?: string;
};

const backgroundClasses: Record<BackgroundVariant, string> = {
  dark: 'bg-dark',
  charcoal: 'bg-charcoal',
  light: 'bg-light',
  cream: 'bg-cream',
  'gradient-dark': 'bg-gradient-dark',
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
      className={`section section-padding ${backgroundClasses[background]} ${className}`}
    >
      <div className="container">
        {children}
      </div>
    </section>
  );
}
