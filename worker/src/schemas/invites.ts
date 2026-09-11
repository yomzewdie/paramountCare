import { z } from 'zod';

export const createInviteSchema = z.object({
  email: z.string().email('Invalid email address'),
});
export type CreateInvitePayload = z.infer<typeof createInviteSchema>;
