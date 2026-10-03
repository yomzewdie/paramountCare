import { render, fireEvent, screen } from '@testing-library/react-native';
import { SHIFT_PREFERENCE_OPTIONS } from '@pcs/shared';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { MultiSelectField } from '../MultiSelectField';

// Same narrow exception as FaqItem.test.tsx: a small reusable primitive whose
// behavior (per-option checked state, tap → onToggle) is interaction-based.
describe('MultiSelectField', () => {
  function renderField(values: string[], onToggle = jest.fn(), error?: string) {
    render(
      <ThemeProvider>
        <MultiSelectField label="Shift Preference" required hint="Select all that apply" options={SHIFT_PREFERENCE_OPTIONS} values={values} onToggle={onToggle} error={error} />
      </ThemeProvider>,
    );
    return onToggle;
  }

  it('renders every option as a checkbox reflecting its selected state', () => {
    renderField(['am', 'pm']);
    expect(screen.getByRole('checkbox', { name: 'AM' }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'MID' }).props.accessibilityState.checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'PM' }).props.accessibilityState.checked).toBe(true);
  });

  it('reports the tapped option value', () => {
    const onToggle = renderField([]);
    fireEvent.press(screen.getByRole('checkbox', { name: 'MID' }));
    expect(onToggle).toHaveBeenCalledWith('mid');
  });

  it('shows the hint when there is no error', () => {
    renderField([]);
    expect(screen.getByText('Select all that apply')).toBeTruthy();
  });

  it('shows the error instead of the hint', () => {
    renderField([], jest.fn(), 'Select at least one shift preference');
    expect(screen.getByText('Select at least one shift preference')).toBeTruthy();
    expect(screen.queryByText('Select all that apply')).toBeNull();
  });
});
