type SiteUrlEnvironment = {
  SITE_URL?: string;
  NEXT_PUBLIC_SITE_URL?: string;
};

export function getSiteUrl(env?: SiteUrlEnvironment) {
  const source = env ?? (process.env as unknown as SiteUrlEnvironment);
  const configured = source.SITE_URL ?? source.NEXT_PUBLIC_SITE_URL;
  if (!configured) return null;

  try {
    const url = new URL(configured);
    return new URL(url.origin);
  } catch {
    return null;
  }
}
