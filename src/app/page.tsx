import { AftertouchControlPanel } from '@/components/aftertouch-control-panel';
import { GameHud } from '@/components/game-hud';
import { VehicleScene } from '@/components/vehicle-scene';

export default function Home() {
  return (
    <main className="relative min-h-screen w-full bg-background text-foreground overflow-hidden">
      <div className="absolute inset-0">
        <VehicleScene />
      </div>
      <GameHud />
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center p-4 md:items-end md:justify-end md:p-8">
        <AftertouchControlPanel />
      </div>
    </main>
  );
}
