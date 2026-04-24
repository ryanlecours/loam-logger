import type { ReactNode } from 'react';

type Props = {
  eyebrow: string;
  title: string;
  description?: ReactNode;
};

export default function SettingsSectionHeader({ eyebrow, title, description }: Props) {
  return (
    <div>
      <p className="label-section">{eyebrow}</p>
      <h2 className="title-page">{title}</h2>
      {description && <p className="text-body-muted mt-1 max-w-2xl">{description}</p>}
    </div>
  );
}
