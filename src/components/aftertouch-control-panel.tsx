"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { handleAftertouchCheck } from "@/app/actions";
import type { AftertouchControlOutput } from "@/ai/flows/aftertouch-control";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { Separator } from "./ui/separator";

const formSchema = z.object({
    vehicleSpeed: z.number().min(0).max(200),
    impactAngle: z.number().min(0).max(180),
    environmentalObjects: z.string().min(3, "Please describe nearby objects.").max(100, "Description is too long."),
});

type FormValues = z.infer<typeof formSchema>;

export function AftertouchControlPanel() {
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<AftertouchControlOutput | null>(null);
    const [error, setError] = useState<string | null>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            vehicleSpeed: 80,
            impactAngle: 45,
            environmentalObjects: "guardrail, concrete wall",
        },
    });

    async function onSubmit(values: FormValues) {
        setIsLoading(true);
        setError(null);
        setResult(null);
        try {
            const res = await handleAftertouchCheck(values);
            setResult(res);
        } catch (e) {
            setError("An error occurred. Please try again.");
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    }
    
    return (
        <Card className="w-full max-w-md bg-card/80 backdrop-blur-sm border-primary/20 shadow-lg shadow-primary/10">
            <CardHeader>
                <CardTitle className="font-headline text-2xl">Aftertouch Control Simulator</CardTitle>
                <CardDescription>Determine if Aftertouch is granted post-crash.</CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="vehicleSpeed"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Vehicle Speed (MPH): {field.value}</FormLabel>
                                    <FormControl>
                                        <Slider
                                            min={0}
                                            max={200}
                                            step={1}
                                            value={[field.value]}
                                            onValueChange={(vals) => field.onChange(vals[0])}
                                            disabled={isLoading}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="impactAngle"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Impact Angle (°): {field.value}</FormLabel>
                                    <FormControl>
                                        <Slider
                                            min={0}
                                            max={180}
                                            step={1}
                                            value={[field.value]}
                                            onValueChange={(vals) => field.onChange(vals[0])}
                                            disabled={isLoading}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                         <FormField
                            control={form.control}
                            name="environmentalObjects"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nearby Environmental Objects</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g., guardrail, traffic car" {...field} disabled={isLoading} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" className="w-full font-headline" disabled={isLoading}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Analyze Crash
                        </Button>
                    </form>
                </Form>
            </CardContent>
            {(isLoading || result || error) && (
                <CardFooter className="flex-col items-start gap-4 pt-6">
                    <Separator />
                    {result && (
                        <div className="space-y-2 w-full pt-4">
                           <div className="flex items-center gap-2">
                            {result.allowAftertouch ? <ThumbsUp className="h-6 w-6 text-green-500" /> : <ThumbsDown className="h-6 w-6 text-destructive" />}
                             <h3 className={`font-headline text-lg ${result.allowAftertouch ? 'text-green-500' : 'text-destructive'}`}>
                                 Aftertouch Control: {result.allowAftertouch ? "Granted" : "Denied"}
                             </h3>
                           </div>
                           <p className="text-sm text-muted-foreground">{result.reason}</p>
                        </div>
                    )}
                    {error && <p className="text-sm text-destructive pt-4">{error}</p>}
                </CardFooter>
            )}
        </Card>
    );
}
