// Example: ThemeToggle.tsx
import { useTheme } from '../hooks/useTheme';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} aria-label="Toggle theme" className="btn-primary">
      Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
    </button>
  );
}