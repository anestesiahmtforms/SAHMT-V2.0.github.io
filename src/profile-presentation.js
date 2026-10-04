const normalizedEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

export function profileForPresentation(profile, user) {
  if (!profile || !user || typeof profile.uid !== 'string' || !profile.uid || profile.uid !== user.uid) return profile;
  const email = normalizedEmail(profile.email);
  if (!email || email !== normalizedEmail(user.email) || normalizedEmail(profile.displayName) !== email || user.emailVerified !== true) return profile;
  if (!Array.isArray(user.providerData) || !user.providerData.some((provider) => provider?.providerId === 'google.com')) return profile;
  const name = typeof user.displayName === 'string' ? user.displayName.trim() : '';
  if (!name || name.length > 120 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) return profile;
  return {...profile, displayName: name};
}
