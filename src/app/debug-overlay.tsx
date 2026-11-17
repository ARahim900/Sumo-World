import { useEffect, useState } from 'react';
import type { DebugInfo, RuntimeApi, Snapshot } from '../game/core/types';
import { qualityLabel, weatherLabel } from './settings';

const POLL_MS = 500;

const COUNTERS: ReadonlyArray<[keyof DebugInfo, string]> = [
  ['drawCalls', 'Draw calls'],
  ['triangles', 'Triangles'],
  ['points', 'Points'],
  ['lines', 'Lines'],
  ['geometries', 'Geometries'],
  ['textures', 'Textures'],
  ['programs', 'Programs'],
];

/** Renderer counters for `?debug`; polls instead of riding the 10 Hz HUD snapshot. */
export function DebugOverlay({ api, state }: { api: RuntimeApi | null; state: Snapshot }) {
  const [info, setInfo] = useState<DebugInfo | null>(null);

  useEffect(() => {
    if (!api || !state.ready) return;
    const read = () => setInfo(api.getDebugInfo());
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => window.clearInterval(timer);
  }, [api, state.ready]);

  const counter = (key: keyof DebugInfo) => (info ? info[key].toLocaleString('en-GB') : '—');
  const auto = state.weatherSetting === 'auto' ? ' (auto)' : '';
  const rows: ReadonlyArray<[string, string]> = [
    ['FPS', info ? String(Math.round(info.fps)) : '—'],
    ...COUNTERS.map(([key, label]): [string, string] => [label, counter(key)]),
    ['Quality', qualityLabel(state.quality)],
    ['Weather', `${weatherLabel(state.weather)}${auto}`],
    ['Position', `${state.x.toFixed(1)}, ${state.z.toFixed(1)}`],
  ];

  return (
    <aside className="debug-overlay" aria-label="Debug information">
      <h2>DEBUG</h2>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
