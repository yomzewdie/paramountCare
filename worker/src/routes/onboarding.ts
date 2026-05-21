import { Hono } from 'hono';
import { submitOnboardingSchema } from '../schemas/onboarding';
import { generateApplicationId } from '../utils/applicationId';

const onboarding = new Hono();

onboarding.post('/submit-onboarding', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const result = submitOnboardingSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        issues: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      422,
    );
  }

  return c.json(
    {
      success: true,
      applicationId: generateApplicationId(),
      submittedAt: new Date().toISOString(),
    },
    201,
  );
});

onboarding.get('/application/:id', (c) => {
  const id = c.req.param('id');
  return c.json({
    id,
    status: 'under_review',
    submittedAt: new Date().toISOString(),
  });
});

export { onboarding };
