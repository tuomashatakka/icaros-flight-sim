"use client"

import { Leva } from 'leva';
import { useStore } from "@/hooks/use-store";
import { useKeyboardControls } from '@/hooks/use-mobile';

function Speedometer() {
    const speed = useStore((state) => state.speed);
    const speedKmh = (speed * 3.6).toFixed(0);

    return (
        <div className="absolute bottom-8 right-8 text-white text-4xl font-mono bg-black/50 p-4 rounded-lg">
            <span>{speedKmh}</span>
            <span className="text-xl ml-2">km/h</span>
        </div>
    );
}

function Minimap() {
    return (
        <div className="absolute top-8 right-8 w-48 h-48 bg-black/50 rounded-full border-2 border-primary/50 flex items-center justify-center">
            <div className="w-2 h-2 bg-accent rounded-full" title="Player"></div>
            <p className="absolute -bottom-8 text-sm text-muted-foreground">Minimap</p>
        </div>
    );
}

function Controls() {
    return (
        <div className="absolute bottom-8 left-8 text-white text-sm font-mono bg-black/50 p-4 rounded-lg">
            <p>W, S / Arrows: Accelerate/Brake</p>
            <p>A, D / Arrows: Steer</p>
            <p>Space: Brake</p>
            <p>R: Reset</p>
        </div>
    );
}

function Editor() {
    return <Leva collapsed />;
}

export function GameUI() {
    useKeyboardControls(); // Initialize keyboard controls

    return (
        <>
            <Editor />
            <Speedometer />
            <Minimap />
            <Controls />
        </>
    )
}
