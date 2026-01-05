import { useContext } from 'react';
import { PreferencesContext } from '../providers/PreferencesContext';

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
