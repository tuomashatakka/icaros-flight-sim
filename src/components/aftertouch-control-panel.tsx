"use client"

import { Leva } from 'leva';
import { useStore } from "@/hooks/use-store";
import { useControls } from '@/hooks/use-mobile';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';

function SpeedGauge() {
    const speed = useStore((state) => state.speed);
    const zone = useStore((state) => state.zone);
    const speedLevels = useStore((state) => state.speedLevels);
    const maxSpeedForZone = 25 * (zone + 2);
    const speedPercentage = Math.min((speed / maxSpeedForZone) * 100, 100);

    const visibleLevels = useMemo(() => {
        const currentLevelIndex = speedLevels.findIndex(level => level.zone === zone);
        if (currentLevelIndex === -1) return [];
        
        const start = Math.max(0, currentLevelIndex - 2);
        const end = Math.min(speedLevels.length, currentLevelIndex + 4);
        return speedLevels.slice(start, end).map((level, index) => ({
            ...level,
            // position is from -2 (top) to 3 (bottom), 0 is the center
            position: (start + index) - currentLevelIndex,
        }));
    }, [zone, speedLevels]);

    return (
        <div className="absolute top-1/2 left-8 -translate-y-1/2 w-48 h-96 text-white font-mono bg-black/50 p-4 rounded-lg flex flex-col items-center justify-center overflow-hidden">
            <div className="absolute inset-y-0 right-4 flex flex-col justify-center items-center">
                <div className="w-2 h-full bg-primary/20 rounded-full">
                    <div className="w-full bg-accent rounded-full transition-all duration-500" style={{ height: `${speedPercentage}%` }}></div>
                </div>
            </div>

            <div className="relative w-full h-full flex items-center justify-start">
                {/* Center marker */}
                <div className="absolute left-0 w-full h-px bg-accent z-20"></div>
                <div className="absolute left-0 -translate-x-4 w-4 h-4 border-y-2 border-l-2 border-accent rounded-l-sm"></div>
                
                <div className="relative w-full h-full transition-transform duration-500 ease-linear" style={{ transform: `translateY(-${(speed / maxSpeedForZone) * 25}%)`}}>
                    {visibleLevels.map((level) => (
                         <div key={level.zone} className="absolute w-full transition-all duration-500 ease-linear" style={{ top: `calc(50% + ${level.position * 25}% - 12px)` }}>
                            <span className={`text-lg ${level.zone === zone ? 'text-accent font-bold' : 'text-white/50'}`}>
                                ZONE {level.zone}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}


function TakedownCounter() {
    const takedowns = useStore((state) => state.takedowns);

    return (
        <div className="absolute top-8 left-8 text-white text-2xl font-mono bg-black/50 p-3 rounded-lg">
            <span>Takedowns: {takedowns}</span>
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
        <div className="absolute bottom-8 left-8 text-white text-sm font-mono bg-black/50 p-4 rounded-lg hidden md:block">
            <p>Arrows: Steer</p>
            <p>Shift: Amplify Steer</p>
            <p>R: Reset</p>
        </div>
    );
}

function Editor() {
    return <Leva collapsed />;
}

export function GameUI() {
    useControls(); // Initialize controls

    return (
        <>
            <Editor />
            <TakedownCounter />
            <SpeedGauge />
            <Minimap />
            <Controls />
        </>
    )
}
