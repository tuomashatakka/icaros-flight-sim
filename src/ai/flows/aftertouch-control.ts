// 'use server';
/**
 * @fileOverview Determines if 'aftertouch control' can be applied after a crash, giving the player limited vehicle control to strategically position the wreck and potentially cause further chaos.
 *
 * - aftertouchControl - A function that determines if aftertouch control can be applied.
 * - AftertouchControlInput - The input type for the aftertouchControl function.
 * - AftertouchControlOutput - The return type for the aftertouchControl function.
 */

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AftertouchControlInputSchema = z.object({
  vehicleSpeed: z.number().describe('The speed of the vehicle at the time of the crash.'),
  impactAngle: z.number().describe('The angle of the impact in degrees relative to the vehicle heading.'),
  environmentalObjects: z.string().describe('The nearby environmental objects, comma separated.'),
});
export type AftertouchControlInput = z.infer<typeof AftertouchControlInputSchema>;

const AftertouchControlOutputSchema = z.object({
  allowAftertouch: z.boolean().describe('Whether or not aftertouch control should be enabled.'),
  reason: z.string().describe('The reason for allowing or disallowing aftertouch control.'),
});
export type AftertouchControlOutput = z.infer<typeof AftertouchControlOutputSchema>;

export async function aftertouchControl(input: AftertouchControlInput): Promise<AftertouchControlOutput> {
  return aftertouchControlFlow(input);
}

const prompt = ai.definePrompt({
  name: 'aftertouchControlPrompt',
  input: {schema: AftertouchControlInputSchema},
  output: {schema: AftertouchControlOutputSchema},
  prompt: `You are an expert game mechanic specializing in determining whether to allow a player "aftertouch" control after a crash in a racing game.

You will use the crash conditions to determine whether or not the player should be given aftertouch control.

Aftertouch control allows the player limited control of the vehicle even after crashing, allowing them to strategically influence the wreckage.

Determine if aftertouch should be allowed based on the following:

Vehicle Speed: {{vehicleSpeed}}
Impact Angle: {{impactAngle}}
Environmental Objects: {{environmentalObjects}}

Consider the following:
*   Aftertouch should generally be allowed unless it would lead to an unfair advantage or break the game.
*   Aftertouch should be disallowed at very high speeds, since the player would have no control at that point.
*   Aftertouch should be disallowed if the vehicle is already in a position where it can cause maximum chaos.
`,
});

const aftertouchControlFlow = ai.defineFlow(
  {
    name: 'aftertouchControlFlow',
    inputSchema: AftertouchControlInputSchema,
    outputSchema: AftertouchControlOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
