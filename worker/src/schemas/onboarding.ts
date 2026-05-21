import { z } from 'zod';

export const submitOnboardingSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Phone number must be at least 10 characters'),
});

export type SubmitOnboardingPayload = z.infer<typeof submitOnboardingSchema>;
