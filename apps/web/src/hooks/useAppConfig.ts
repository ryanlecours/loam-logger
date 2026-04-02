import { useState, useEffect } from 'react';

interface AppConfig {
  waitlistEnabled: boolean;
}

let cachedConfig: AppConfig | null = null;

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig | null>(cachedConfig);
  const [loading, setLoading] = useState(!cachedConfig);

  useEffect(() => {
    if (cachedConfig) return;

    fetch(`${import.meta.env.VITE_API_URL}/api/config`)
      .then((res) => res.json())
      .then((data: AppConfig) => {
        cachedConfig = data;
        setConfig(data);
      })
      .catch(() => {
        // Default to waitlist enabled if fetch fails
        const fallback: AppConfig = { waitlistEnabled: true };
        setConfig(fallback);
      })
      .finally(() => setLoading(false));
  }, []);

  return {
    waitlistEnabled: config?.waitlistEnabled ?? true,
    loading,
  };
}
