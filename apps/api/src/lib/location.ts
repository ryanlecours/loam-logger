export const buildLocationString = (
  parts: Array<string | null | undefined>
): string | null => {
  const cleaned = parts
    .map((part) => (typeof part === 'string' ? part.trim() : part))
    .filter((part): part is string => Boolean(part && part.length > 0));

  return cleaned.length ? cleaned.join(', ') : null;
};

export const formatLatLon = (
  lat?: number | null,
  lon?: number | null
): string | null => {
  if (!Number.isFinite(lat ?? NaN) || !Number.isFinite(lon ?? NaN)) {
    return null;
  }

  const latStr = (lat as number).toFixed(3);
  const lonStr = (lon as number).toFixed(3);
  return `Lat ${latStr}, Lon ${lonStr}`;
};

export const deriveLocation = (opts: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  fallback?: string | null;
  lat?: number | null;
  lon?: number | null;
}): string | null => {
  const singleValue = opts.city ?? opts.state ?? opts.country ?? opts.fallback ?? null;

  return (
    buildLocationString([opts.city, opts.state]) ??
    buildLocationString([opts.city, opts.country]) ??
    buildLocationString([opts.state, opts.country]) ??
    (singleValue?.trim() || null) ??
    formatLatLon(opts.lat, opts.lon)
  );
};

export const shouldApplyAutoLocation = (
  existing: string | null | undefined,
  incoming: string | null
): string | undefined => {
  if (!incoming) return undefined;
  if (existing && existing.trim().length > 0) return undefined;
  return incoming;
};
