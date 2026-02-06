// Curated palette of visually distinct, accessible colors for avatars
// These colors are chosen to:
// 1. Be visually distinct from each other
// 2. Have good contrast with white text
// 3. Look professional and modern
const AVATAR_COLORS = [
  // Reds & Pinks
  '#E91E63', // pink
  '#F44336', // red
  '#C62828', // red dark
  '#AD1457', // pink dark
  '#D81B60', // pink medium

  // Purples
  '#9C27B0', // purple
  '#673AB7', // deep purple
  '#5E35B1', // deep purple dark
  '#7B1FA2', // purple dark
  '#8E24AA', // purple medium
  '#6A1B9A', // purple deeper

  // Blues
  '#3F51B5', // indigo
  '#2196F3', // blue
  '#03A9F4', // light blue
  '#1E88E5', // blue dark
  '#1565C0', // blue deeper
  '#0277BD', // light blue dark
  '#283593', // indigo dark
  '#304FFE', // indigo accent

  // Cyans & Teals
  '#00BCD4', // cyan
  '#009688', // teal
  '#00897B', // teal dark
  '#00838F', // cyan dark
  '#00695C', // teal deeper
  '#0097A7', // cyan medium

  // Greens
  '#4CAF50', // green
  '#8BC34A', // light green
  '#43A047', // green dark
  '#2E7D32', // green deeper
  '#558B2F', // light green dark
  '#689F38', // light green medium

  // Oranges & Yellows
  '#FF9800', // orange
  '#FF5722', // deep orange
  '#FB8C00', // orange dark
  '#EF6C00', // orange deeper
  '#E65100', // deep orange dark
  '#F57C00', // orange medium
  '#FFA000', // amber

  // Browns & Greys
  '#795548', // brown
  '#607D8B', // blue grey
  '#5D4037', // brown dark
  '#4E342E', // brown deeper
  '#455A64', // blue grey dark
  '#546E7A', // blue grey medium
  '#6D4C41', // brown medium
] as const;

/**
 * Generate a deterministic hash from a string
 * Uses djb2 algorithm for better distribution
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Get a deterministic color for a string (e.g., email address)
 * Same string will always produce the same color
 */
export function stringToColor(str: string): string {
  const hash = hashString(str);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * Get initials from an email address
 * Examples:
 *   "john.doe@example.com" -> "JD"
 *   "alice@example.com" -> "AL"
 */
export function getInitials(email: string): string {
  const localPart = email.split('@')[0];
  const parts = localPart.split(/[._-]/);

  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return localPart.slice(0, 2).toUpperCase();
}
