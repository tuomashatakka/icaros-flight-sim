import { ShieldAlert, Zap } from 'lucide-react';

function TakedownIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-4.44l-3 3v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V5l-3-3z"/>
            <path d="M10.29 14.71L12 13l1.71 1.71"/>
            <path d="M12 2v11"/>
            <path d="m17 2-5 5-5-5"/>
        </svg>
    );
}

export function GameHud() {
    return (
        <>
            <div className="absolute top-4 left-4 md:top-8 md:left-8 text-white">
                <h1 className="font-headline text-4xl md:text-6xl text-primary drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">
                    Crash Velocity
                </h1>
                <p className="text-accent drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">Burnout-inspired Vehicular Mayhem</p>
            </div>

            <div className="absolute bottom-4 right-4 md:bottom-8 md:right-8 flex items-end gap-6 text-white">
                <div className="flex flex-col items-center gap-1 text-center">
                    <div className="w-24 h-1 bg-white/30 rounded-full overflow-hidden">
                        <div className="h-full bg-accent" style={{width: '75%'}}></div>
                    </div>
                    <span className="text-xs font-mono flex items-center gap-1 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"><Zap size={14} className="text-accent"/> BOOST</span>
                </div>
                 <div className="flex flex-col items-center gap-2">
                    <span className="font-headline text-5xl text-accent drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">128</span>
                    <span className="font-mono text-lg drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">MPH</span>
                 </div>
            </div>

            <div className="absolute bottom-4 left-4 md:bottom-8 md:left-8 flex items-center gap-4 text-white">
                 <div className="flex items-center gap-2 p-2 rounded-lg bg-black/30 backdrop-blur-sm border border-white/10">
                    <TakedownIcon />
                    <span className="font-headline text-2xl">x5</span>
                 </div>
                 <div className="flex items-center gap-2 p-2 rounded-lg bg-black/30 backdrop-blur-sm border border-white/10">
                    <ShieldAlert className="text-destructive"/>
                    <span className="font-headline text-2xl">72%</span>
                 </div>
            </div>
        </>
    );
}
