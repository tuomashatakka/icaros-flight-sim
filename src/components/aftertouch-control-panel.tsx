
"use client"

import Link from 'next/link';
import { Leva } from 'leva';
import { useStore } from "@/hooks/use-store";
import { useRaceStore, formatTime } from "@/hooks/use-race-store";
import { useEffect, useMemo, useState } from 'react';

function BackToMenu() {
    return (
        <Link
            href="/"
            className="absolute top-8 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black/50 px-4 py-2 font-mono text-sm text-white/80 transition-colors hover:text-accent"
        >
            ‹ Menu
        </Link>
    );
}

function SpeedGauge() {
    const speed = useStore((state) => state.speed);
    const zone = useStore((state) => state.zone);
    const speedLevels = useStore((state) => state.speedLevels);
    const maxSpeedForZone = 25 * (zone + 2);
    const speedPercentage = Math.min((speed / maxSpeedForZone) * 100, 100);
    const speedKmph = (speed * 3.6).toFixed(0);

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
                <span className="absolute left-12 text-accent font-bold text-lg">{speedKmph} km/h</span>
                
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
            <p>Arrows / A,D: Steer</p>
            <p>Shift: Boost</p>
            <p>R: Respawn</p>
        </div>
    );
}

/** Lap/timer readout, the 3-2-1 countdown, and the finish summary. */
function RaceHud() {
    const status = useRaceStore((s) => s.status);
    const countdown = useRaceStore((s) => s.countdown);
    const currentLap = useRaceStore((s) => s.currentLap);
    const laps = useRaceStore((s) => s.laps);
    const loop = useRaceStore((s) => s.loop);
    const lapElapsed = useRaceStore((s) => s.lapElapsed);
    const elapsed = useRaceStore((s) => s.elapsed);
    const bestLap = useRaceStore((s) => s.bestLap);
    const lapTimes = useRaceStore((s) => s.lapTimes);
    const resetRace = useRaceStore((s) => s.resetRace);

    return (
        <>
            <div className="absolute top-8 left-1/2 -translate-x-1/2 z-40 flex gap-6 rounded-lg bg-black/50 px-6 py-3 font-mono text-white">
                <div className="text-center">
                    <div className="text-xs text-white/50">{loop ? 'LAP' : 'RUN'}</div>
                    <div className="text-xl font-bold text-accent">{loop ? `${Math.min(currentLap, laps)}/${laps}` : 'SPRINT'}</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-white/50">TIME</div>
                    <div className="text-xl font-bold tabular-nums">{formatTime(elapsed)}</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-white/50">LAP</div>
                    <div className="text-xl font-bold tabular-nums text-accent">{formatTime(lapElapsed)}</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-white/50">BEST</div>
                    <div className="text-xl font-bold tabular-nums">{bestLap === null ? '--:--' : formatTime(bestLap)}</div>
                </div>
            </div>

            {status === 'countdown' && (
                <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
                    <span className="font-mono text-9xl font-black text-accent drop-shadow-[0_0_25px_rgba(255,45,111,0.8)]">
                        {Math.ceil(countdown)}
                    </span>
                </div>
            )}

            {status === 'racing' && elapsed < 1 && (
                <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
                    <span className="font-mono text-9xl font-black text-green-400 drop-shadow-[0_0_25px_rgba(74,222,128,0.8)]">GO!</span>
                </div>
            )}

            {status === 'finished' && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
                    <div className="rounded-xl bg-black/80 p-8 text-center font-mono text-white">
                        <h2 className="mb-2 text-4xl font-black text-accent">FINISH</h2>
                        <p className="mb-1 text-2xl">Total: <span className="tabular-nums">{formatTime(elapsed)}</span></p>
                        <p className="mb-4 text-lg text-white/70">Best lap: <span className="tabular-nums">{bestLap === null ? '--' : formatTime(bestLap)}</span></p>
                        {lapTimes.length > 1 && (
                            <ul className="mb-4 text-sm text-white/60">
                                {lapTimes.map((t, i) => (
                                    <li key={i}>Lap {i + 1}: <span className="tabular-nums">{formatTime(t)}</span></li>
                                ))}
                            </ul>
                        )}
                        <button
                            onClick={resetRace}
                            className="rounded-lg bg-accent px-6 py-2 font-bold text-black transition-transform hover:scale-105"
                        >
                            Race Again
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

/** Boost reserve bar. */
function BoostMeter() {
    const boost = useStore((s) => s.boostMeter);
    return (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 w-64">
            <div className="h-3 overflow-hidden rounded-full border border-white/20 bg-black/50">
                <div
                    className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 transition-[width] duration-100"
                    style={{ width: `${boost * 100}%` }}
                />
            </div>
            <p className="mt-1 text-center font-mono text-xs text-white/60">BOOST · hold Shift</p>
        </div>
    );
}

/** Brief red flash on a hard impact. */
function CrashFlash() {
    const crashFlash = useStore((s) => s.crashFlash);
    const [active, setActive] = useState(false);
    useEffect(() => {
        if (crashFlash === 0) return;
        setActive(true);
        const id = setTimeout(() => setActive(false), 220);
        return () => clearTimeout(id);
    }, [crashFlash]);
    return (
        <div
            className={`pointer-events-none absolute inset-0 z-30 bg-red-600 transition-opacity duration-200 ${active ? 'opacity-40' : 'opacity-0'}`}
        />
    );
}

function Editor() {
    return <Leva collapsed />;
}

export function GameUI() {
    return (
        <>
            <Editor />
            <BackToMenu />
            <RaceHud />
            <TakedownCounter />
            <SpeedGauge />
            <Minimap />
            <BoostMeter />
            <CrashFlash />
            <Controls />
        </>
    )
}
