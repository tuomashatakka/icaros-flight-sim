"use server";

import { aftertouchControl, AftertouchControlInput, AftertouchControlOutput } from "@/ai/flows/aftertouch-control";
import { z } from "zod";

const formSchema = z.object({
    vehicleSpeed: z.number(),
    impactAngle: z.number(),
    environmentalObjects: z.string(),
});

export async function handleAftertouchCheck(input: AftertouchControlInput): Promise<AftertouchControlOutput> {
    const validatedInput = formSchema.parse(input);
    try {
        const result = await aftertouchControl(validatedInput);
        return result;
    } catch (error) {
        console.error("Error in aftertouchControl flow:", error);
        throw new Error("Failed to get a response from the AI.");
    }
}
