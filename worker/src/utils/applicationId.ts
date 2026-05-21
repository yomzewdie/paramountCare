const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateApplicationId(): string {
  const year = new Date().getFullYear();
  const suffix = Array.from(
    { length: 4 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join('');
  return `PCS-${year}-${suffix}`;
}
