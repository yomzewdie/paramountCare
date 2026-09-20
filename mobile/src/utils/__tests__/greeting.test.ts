import { formatGreeting } from '../greeting';

describe('formatGreeting', () => {
  it('greets by first name only', () => {
    expect(formatGreeting('Jonathan')).toBe('Hi, Jonathan');
  });

  it('trims incidental whitespace around the stored first name', () => {
    expect(formatGreeting('  Jonathan  ')).toBe('Hi, Jonathan');
  });

  it('falls back to a generic greeting when first name is null', () => {
    expect(formatGreeting(null)).toBe('Welcome back');
  });

  it('falls back to a generic greeting when first name is undefined', () => {
    expect(formatGreeting(undefined)).toBe('Welcome back');
  });

  it('falls back to a generic greeting when first name is an empty string', () => {
    expect(formatGreeting('')).toBe('Welcome back');
  });

  it('falls back to a generic greeting when first name is only whitespace', () => {
    expect(formatGreeting('   ')).toBe('Welcome back');
  });
});
