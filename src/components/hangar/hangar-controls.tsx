"use client";

import Link from 'next/link';
import { useShipStore } from '@/hooks/use-ship-store';
import { useHangarView, type HangarViewToggle } from '@/hooks/use-hangar-view';
import { PALETTES } from '@/lib/ship/materials';
import { SHIP_IDS, SHIP_PRESETS, type ShipConfig } from '@/lib/ship/registry';
import { cn } from '@/lib/utils';

/**
 * Labelled slider.
 *
 * The panel is ~a dozen of these; spelling each one out (as the previous
 * version did) buried the two that actually differ in a wall of identical
 * markup. Value formatting is injectable because degrees, multipliers and bare
 * 0..1 ratios all want different suffixes.
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v: number) => v.toFixed(2),
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-foreground/70">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary disabled:cursor-not-allowed"
      />
    </label>
  );
}

function Swatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border bg-transparent px-2 py-1.5 font-mono text-xs"
        />
      </div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs transition-colors',
        on
          ? 'border-primary bg-primary/20 text-foreground'
          : 'border-border text-muted-foreground hover:border-primary/50'
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border/60 p-3">
      <legend className="px-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

const PATTERNS: { value: ShipConfig['texturePreset']; label: string }[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'panels', label: 'Panels' },
  { value: 'carbon', label: 'Carbon Fiber' },
  { value: 'hazard', label: 'Hazard' },
  { value: 'city', label: 'Cityscape' },
  { value: 'gallery', label: 'Gallery' },
];

/** Random livery, in the spirit of the forge prototype's `randomize ✦`. */
function randomLook(): Partial<ShipConfig> {
  const palettes = Object.entries(PALETTES);
  const [name, palette] = palettes[Math.floor(Math.random() * palettes.length)];
  return {
    paletteName: name as ShipConfig['paletteName'],
    bodyColor: palette.bodyColor,
    emissiveColor: palette.emissiveColor,
    metalness: 0.2 + Math.random() * 0.75,
    roughness: 0.15 + Math.random() * 0.7,
    emissiveIntensity: 0.3 + Math.random() * 0.7,
    burnColor: palette.emissiveColor,
    burnIntensity: 0.6 + Math.random() * 1.2,
    burnLength: 0.7 + Math.random() * 1.6,
  };
}

export function HangarControls() {
  const { currentConfig, updateConfig, selectShip, resetToDefault, applyToAllShips } =
    useShipStore();
  const view = useHangarView();

  // Only the glTF ship (cb1) has its maps generated from texturePreset; every other ship
  // carries a baked livery that applyShipConfig() modulates but never overwrites.
  const activePreset = SHIP_PRESETS[currentConfig.shipId];
  const hasBakedLivery = activePreset.kind !== 'gltf';

  const set = <K extends keyof ShipConfig>(key: K, value: ShipConfig[K]) =>
    updateConfig({ [key]: value } as Partial<ShipConfig>);

  const toggle = (key: HangarViewToggle) => () => view.toggle(key);

  return (
    <div className="h-screen w-full overflow-y-auto border-l border-border bg-background/95 p-5 backdrop-blur-sm">
      <header className="mb-5">
        <Link
          href="/"
          className="mb-3 inline-block font-mono text-xs text-muted-foreground transition-colors hover:text-accent"
        >
          ‹ Menu
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">SHIP HANGAR</h1>
        <p className="text-sm text-muted-foreground">
          {SHIP_IDS.length} hulls · drag to orbit · scroll to zoom
        </p>
      </header>

      <div className="space-y-4">
        <Section title="Fleet">
          <div className="grid grid-cols-2 gap-2">
            {SHIP_IDS.map((id) => {
              const preset = SHIP_PRESETS[id];
              const active = currentConfig.shipId === id;
              return (
                <button
                  key={id}
                  onClick={() => selectShip(id)}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-all',
                    active ? 'border-primary bg-primary/20' : 'border-border hover:border-primary/50'
                  )}
                >
                  <div className="text-sm font-medium">{preset.label}</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">
                    {preset.description}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Toggle on={false} onClick={applyToAllShips}>
              apply livery to fleet
            </Toggle>
            <Toggle on={false} onClick={resetToDefault}>
              reset ship
            </Toggle>
            <Toggle on={false} onClick={() => updateConfig(randomLook())}>
              randomize ✦
            </Toggle>
          </div>
        </Section>

        <Section title="Livery">
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(PALETTES).map(([key, palette]) => (
              <button
                key={key}
                onClick={() =>
                  updateConfig({
                    paletteName: key as ShipConfig['paletteName'],
                    bodyColor: palette.bodyColor,
                    emissiveColor: palette.emissiveColor,
                    metalness: palette.metalness,
                    roughness: palette.roughness,
                    emissiveIntensity: palette.emissiveIntensity,
                  })
                }
                className={cn(
                  'rounded-lg border p-1.5 transition-all',
                  currentConfig.paletteName === key
                    ? 'border-primary'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <div
                  className="mb-1 h-7 w-full rounded"
                  style={{
                    background: `linear-gradient(135deg, ${palette.bodyColor} 60%, ${palette.emissiveColor})`,
                  }}
                />
                <div className="text-[11px] font-medium">{palette.name}</div>
              </button>
            ))}
          </div>
          <Swatch
            label="body"
            value={currentConfig.bodyColor}
            onChange={(v) => set('bodyColor', v)}
          />
          <Swatch
            label="emissive"
            value={currentConfig.emissiveColor}
            onChange={(v) => set('emissiveColor', v)}
          />
        </Section>

        <Section title="Materials & Texture">
          <Slider
            label="metalness"
            value={currentConfig.metalness}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => set('metalness', v)}
          />
          <Slider
            label="roughness"
            value={currentConfig.roughness}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => set('roughness', v)}
          />
          <Slider
            label="emission"
            value={currentConfig.emissiveIntensity}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => set('emissiveIntensity', v)}
          />

          {hasBakedLivery ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {activePreset.label} ships a baked team livery — patterns are disabled so it stays
              recognisable. The sliders above still apply on top of it.
            </p>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">pattern</span>
                <select
                  value={currentConfig.texturePreset}
                  onChange={(e) =>
                    set('texturePreset', e.target.value as ShipConfig['texturePreset'])
                  }
                  className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
                >
                  {PATTERNS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <Slider
                label="texture repeat"
                value={currentConfig.textureRepeat}
                min={0.5}
                max={5}
                step={0.25}
                onChange={(v) => set('textureRepeat', v)}
                format={(v) => `${v.toFixed(2)}×`}
              />
            </>
          )}
        </Section>

        <Section title="Afterburner">
          <Swatch
            label="plume"
            value={currentConfig.burnColor}
            onChange={(v) => set('burnColor', v)}
          />
          <Slider
            label="beam intensity"
            value={currentConfig.burnIntensity}
            min={0}
            max={2.2}
            step={0.01}
            onChange={(v) => set('burnIntensity', v)}
          />
          <Slider
            label="beam length"
            value={currentConfig.burnLength}
            min={0.4}
            max={3}
            step={0.01}
            onChange={(v) => set('burnLength', v)}
          />
          <Slider
            label="nozzle spread"
            value={currentConfig.nozzleSpread}
            min={0}
            max={1.6}
            step={0.01}
            onChange={(v) => set('nozzleSpread', v)}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Pods are found by scanning the hull&apos;s tail for its two thickest points, so 1.00 is
            wherever the geometry says the engines are — nudge it if a beam misses. The plume
            follows your throttle out on the track.
          </p>
        </Section>

        <Section title="View">
          <div className="flex flex-wrap gap-2">
            <Toggle on={view.autoOrbit} onClick={toggle('autoOrbit')}>
              auto-orbit
            </Toggle>
            <Toggle on={view.flightTilt} onClick={toggle('flightTilt')}>
              flight tilt
            </Toggle>
            <Toggle on={view.engines} onClick={toggle('engines')}>
              engines
            </Toggle>
            <Toggle on={view.wireframe} onClick={toggle('wireframe')}>
              wire overlay
            </Toggle>
          </div>
        </Section>
      </div>
    </div>
  );
}
