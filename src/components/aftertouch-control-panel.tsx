"use client"

import { Leva } from 'leva';
import { useStore } from "@/hooks/use-store";
import { useControls } from '@/hooks/use-mobile';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { useEffect, useState } from 'react';

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
            <p>W, S / Arrows: Accel/Brake</p>
            <p>A, D / Arrows: Steer</p>
            <p>Space: Brake</p>
            <p>R: Reset</p>
        </div>
    );
}

function TouchControls() {
    const { setControls } = useControls();
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);
    
    if (!isMobile) return null;

    return (
        <div className="absolute bottom-8 inset-x-8 flex justify-between md:hidden">
            <div className="flex flex-col gap-4">
                 <Button 
                    className="w-24 h-24 rounded-full bg-black/30 text-white text-4xl"
                    onTouchStart={() => setControls({ forward: true })}
                    onTouchEnd={() => setControls({ forward: false })}
                >
                    <ArrowUp size={48} />
                </Button>
                 <Button 
                    className="w-24 h-24 rounded-full bg-black/30 text-white text-4xl"
                    onTouchStart={() => setControls({ backward: true })}
                    onTouchEnd={() => setControls({ backward: false })}
                >
                    <ArrowDown size={48} />
                </Button>
            </div>
            <div className="flex items-center gap-4">
                <Button 
                    className="w-24 h-24 rounded-full bg-black/30 text-white text-4xl"
                    onTouchStart={() => setControls({ left: true })}
                    onTouchEnd={() => setControls({ left: false })}
                >
                    <ChevronLeft size={48} />
                </Button>
                <Button 
                    className="w-24 h-24 rounded-full bg-black/30 text-white text-4xl"
                    onTouchStart={() => setControls({ right: true })}
                    onTouchEnd={() => setControls({ right: false })}
                >
                    <ChevronRight size={48} />
                </Button>
            </div>
        </div>
    )
}


function Editor() {
    return <Leva collapsed />;
}

export function GameUI() {
    useControls(); // Initialize keyboard controls

    return (
        <>
            <Editor />
            <TakedownCounter />
            <Speedometer />
            <Minimap />
            <Controls />
            <TouchControls />
        </>
    )
}
