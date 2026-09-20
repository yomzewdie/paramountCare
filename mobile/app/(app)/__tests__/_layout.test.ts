import { TAB_CONFIG } from '../_layout';

// Verifies the bottom tab bar's real content/order directly, without a full
// navigator render — same reasoning as onboarding/__tests__/stepId.test.ts's
// REAL_STEP_SCREENS check (this project deliberately avoids snapshot/full-
// render screen tests — see jest.config.js).
describe('bottom tab configuration (TAB_CONFIG)', () => {
  it('has exactly four tabs, in the required order: Home, Onboarding, Profile, Help', () => {
    expect(TAB_CONFIG.map((t) => t.name)).toEqual(['home', 'onboarding', 'profile', 'help']);
  });

  it('Help is the fourth/last tab', () => {
    expect(TAB_CONFIG).toHaveLength(4);
    expect(TAB_CONFIG[TAB_CONFIG.length - 1].name).toBe('help');
  });

  it('Help label is exactly "Help"', () => {
    expect(TAB_CONFIG.find((t) => t.name === 'help')?.title).toBe('Help');
  });

  it('Help icon configuration matches the approved mapping (help-circle / help-circle-outline)', () => {
    const help = TAB_CONFIG.find((t) => t.name === 'help')!;
    expect(help.activeIcon).toBe('help-circle');
    expect(help.inactiveIcon).toBe('help-circle-outline');
  });

  it('every other tab\'s label/icon configuration is unchanged from the approved app shell', () => {
    expect(TAB_CONFIG.find((t) => t.name === 'home')).toMatchObject({ title: 'Home', activeIcon: 'home', inactiveIcon: 'home-outline' });
    expect(TAB_CONFIG.find((t) => t.name === 'onboarding')).toMatchObject({ title: 'Onboarding', activeIcon: 'clipboard', inactiveIcon: 'clipboard-outline' });
    expect(TAB_CONFIG.find((t) => t.name === 'profile')).toMatchObject({ title: 'Profile', activeIcon: 'person', inactiveIcon: 'person-outline' });
  });

  it('the "onboarding" tab route name itself is untouched by the "Onboarding" display label (route stays the real folder/file name)', () => {
    expect(TAB_CONFIG.find((t) => t.title === 'Onboarding')?.name).toBe('onboarding');
  });
});
