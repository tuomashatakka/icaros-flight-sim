"use client";

import Link from 'next/link';
import { useShipStore } from '@/hooks/use-ship-store';
import { PALETTES } from '@/lib/ship/materials';
import { cn } from '@/lib/utils';

export function HangarControls() {
  const { currentConfig, updateConfig, selectShip, resetToDefault } = useShipStore();
  
  const handleControlChange = (key: string, value: unknown) => {
    updateConfig({ [key]: value } as Partial<typeof currentConfig>);
  };

  const handleShipSelect = (shipId: 'cb1' | 'icaras') => {
    selectShip(shipId);
  };

  const isCb1 = currentConfig.shipId === 'cb1';

  return (
    <div className="w-80 bg-background/95 backdrop-blur-sm border-r border-border p-6 overflow-y-auto h-screen">
      <header className="mb-6">
        <Link
          href="/"
          className="mb-3 inline-block font-mono text-xs text-muted-foreground transition-colors hover:text-accent"
        >
          ‹ Menu
        </Link>
        <h1 className="text-2xl font-bold">SHIP HANGAR</h1>
        <p className="text-sm text-muted-foreground">Customize your racer</p>
      </header>

      <div className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Ship Selection</legend>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleShipSelect('cb1')}
              className={cn(
                "p-3 rounded-lg border transition-all",
                isCb1
                  ? "border-primary bg-primary/20"
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="font-medium">CB1</div>
              <div className="text-xs text-muted-foreground">Standard racer</div>
            </button>
            <button
              onClick={() => handleShipSelect('icaras')}
              className={cn(
                "p-3 rounded-lg border transition-all",
                !isCb1
                  ? "border-primary bg-primary/20"
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="font-medium">Icaras</div>
              <div className="text-xs text-muted-foreground">Aerodynamic design</div>
            </button>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Color Palette</legend>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(PALETTES).map(([key, palette]) => (
              <button
                key={key}
                onClick={() =>
                  updateConfig({
                    paletteName: key as typeof currentConfig.paletteName,
                    bodyColor: palette.bodyColor,
                    emissiveColor: palette.emissiveColor,
                    metalness: palette.metalness,
                    roughness: palette.roughness,
                    emissiveIntensity: palette.emissiveIntensity,
                  })
                }
                className={cn(
                  "p-2 rounded-lg border transition-all",
                  currentConfig.paletteName === key
                    ? "border-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div
                  className="w-full h-8 rounded mb-1"
                  style={{ background: palette.bodyColor }}
                />
                <div className="text-xs font-medium">{palette.name}</div>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Body Color</legend>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={currentConfig.bodyColor}
              onChange={(e) => handleControlChange('bodyColor', e.target.value)}
              className="w-12 h-12 rounded border border-border"
            />
            <div className="flex-1">
              <input
                type="text"
                value={currentConfig.bodyColor}
                onChange={(e) => handleControlChange('bodyColor', e.target.value)}
                className="w-full px-3 py-2 rounded border border-border bg-transparent"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Emissive Color</legend>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={currentConfig.emissiveColor}
              onChange={(e) => handleControlChange('emissiveColor', e.target.value)}
              className="w-12 h-12 rounded border border-border"
            />
            <div className="flex-1">
              <input
                type="text"
                value={currentConfig.emissiveColor}
                onChange={(e) => handleControlChange('emissiveColor', e.target.value)}
                className="w-full px-3 py-2 rounded border border-border bg-transparent"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Emissive Intensity</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={currentConfig.emissiveIntensity}
              onChange={(e) => handleControlChange('emissiveIntensity', parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Material Properties</legend>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">Metalness: {currentConfig.metalness.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={currentConfig.metalness}
                onChange={(e) => handleControlChange('metalness', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">Roughness: {currentConfig.roughness.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={currentConfig.roughness}
                onChange={(e) => handleControlChange('roughness', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Texture & Details</legend>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">Pattern</label>
              <select
                value={currentConfig.texturePreset}
                onChange={(e) => handleControlChange('texturePreset', e.target.value)}
                className="w-full px-3 py-2 rounded border border-border bg-transparent"
              >
                <option value="plain">Plain</option>
                <option value="panels">Panels</option>
                <option value="carbon">Carbon Fiber</option>
                <option value="hazard">Hazard Pattern</option>
                <option value="city">Cityscape</option>
                <option value="gallery">Gallery</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">Detail Scale: {currentConfig.textureRepeat.toFixed(1)}x</label>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={currentConfig.textureRepeat}
                onChange={(e) => handleControlChange('textureRepeat', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </fieldset>

        <div className="pt-4 border-t border-border">
          <button
            onClick={resetToDefault}
            className="w-full px-4 py-2 rounded border border-border hover:border-primary transition-colors"
          >
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}