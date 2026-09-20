import { render, fireEvent, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { FaqItem } from '../FaqItem';

// A deliberate, narrow exception to this project's usual renderHook-only
// testing convention (jest.config.js's own comment: full-render/snapshot
// tests are avoided for application SCREENS — brittle, low-value). FaqItem
// is a small, generic, reusable presentational primitive with genuinely
// interaction-based behavior (collapse/expand) that isn't expressible as a
// pure function, so a targeted render + fireEvent test is used here
// instead of introducing an artificial pure-function wrapper just to avoid
// rendering.
describe('FaqItem', () => {
  const QUESTION = 'Can I save my progress and finish later?';
  const ANSWER = 'Yes. Your onboarding progress is saved as you go, so you can return and continue where you left off.';

  function renderItem() {
    return render(
      <ThemeProvider>
        <FaqItem question={QUESTION} answer={ANSWER} />
      </ThemeProvider>,
    );
  }

  it('starts collapsed: the question is visible, the answer is not rendered', () => {
    renderItem();
    expect(screen.getByText(QUESTION)).toBeTruthy();
    expect(screen.queryByText(ANSWER)).toBeNull();
  });

  it('the toggle control starts with accessibilityState.expanded === false', () => {
    renderItem();
    expect(screen.getByRole('button', { name: QUESTION }).props.accessibilityState.expanded).toBe(false);
  });

  it('expands to show the answer when tapped, and accessibilityState.expanded becomes true', () => {
    renderItem();
    fireEvent.press(screen.getByRole('button', { name: QUESTION }));
    expect(screen.getByText(ANSWER)).toBeTruthy();
    expect(screen.getByRole('button', { name: QUESTION }).props.accessibilityState.expanded).toBe(true);
  });

  it('collapses again on a second tap, and accessibilityState.expanded returns to false', () => {
    renderItem();
    const toggle = screen.getByRole('button', { name: QUESTION });
    fireEvent.press(toggle);
    expect(screen.getByText(ANSWER)).toBeTruthy();

    fireEvent.press(toggle);
    expect(screen.queryByText(ANSWER)).toBeNull();
    expect(screen.getByRole('button', { name: QUESTION }).props.accessibilityState.expanded).toBe(false);
  });

  it('the toggle control announces the question as its accessible name', () => {
    renderItem();
    const toggle = screen.getByRole('button', { name: QUESTION });
    expect(toggle.props.accessibilityLabel).toBe(QUESTION);
  });
});
