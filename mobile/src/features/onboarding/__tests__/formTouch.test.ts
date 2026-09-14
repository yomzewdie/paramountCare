import { visibleErrors, touchAll } from '../formTouch';

describe('visibleErrors', () => {
  it('keeps only errors whose field has been touched', () => {
    const result = visibleErrors({ firstName: 'Required', email: 'Invalid' }, { firstName: true });
    expect(result).toEqual({ firstName: 'Required' });
  });

  it('returns nothing when no fields are touched', () => {
    expect(visibleErrors({ firstName: 'Required' }, {})).toEqual({});
  });

  it('returns everything when every erroring field is touched', () => {
    const errors = { firstName: 'Required', email: 'Invalid' };
    expect(visibleErrors(errors, { firstName: true, email: true })).toEqual(errors);
  });
});

describe('touchAll', () => {
  it('marks every key of the given shape as touched', () => {
    expect(touchAll({ firstName: '', email: '' })).toEqual({ firstName: true, email: true });
  });

  it('produces an empty object for an empty shape', () => {
    expect(touchAll({})).toEqual({});
  });
});
