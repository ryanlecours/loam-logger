import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RevealAfterMount from './RevealAfterMount';

describe('RevealAfterMount', () => {
  it('drops the prerender guard class once mounted', () => {
    document.documentElement.classList.add('lp-prerendered');
    render(<RevealAfterMount />);
    expect(document.documentElement.classList.contains('lp-prerendered')).toBe(false);
  });

  it('renders nothing', () => {
    const { container } = render(<RevealAfterMount />);
    expect(container).toBeEmptyDOMElement();
  });
});
