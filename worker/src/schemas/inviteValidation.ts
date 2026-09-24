import { z } from 'zod';

// Deliberately lenient (min length 1, no format/charset check here): the
// route normalizes before hashing/lookup, so a malformed value just fails
// the lookup like any other wrong code — validating shape here would only
// let a caller distinguish "badly formed" from "well formed but wrong,"
// which is exactly the kind of oracle the generic public error is meant to
// avoid (see routes/inviteValidation.ts).
export const validateInviteCodeSchema = z.object({
  code: z.string().min(1, 'code is required'),
});
export type ValidateInviteCodePayload = z.infer<typeof validateInviteCodeSchema>;
