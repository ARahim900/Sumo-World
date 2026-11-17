'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Runtime } from '../game/core/runtime';
import { initialSnapshot } from '../game/core/snapshot';
import type { QualityPreset, Snapshot, WeatherSetting } from '../game/core/types';
import { DebugOverlay } from './debug-overlay';
import { Hud } from './hud';
import {
  LOAD_STAGES,
  debugRequested,
  defaultSettings,
  isTouchOnly,
  loadLabel,
  loadProgress,
  loadSettings,
  saveSettings,
  type GameSettings,
  type LoadStage,
} from './settings';
import { SettingsPanel } from './settings-panel';

/** Accessing localStorage itself throws when site data is blocked. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function LoadingStatus({ stage }: { stage: LoadStage }) {
  const step = Math.min(LOAD_STAGES.indexOf(stage) + 1, LOAD_STAGES.length - 1);
  const percent = Math.round(loadProgress(stage) * 100);
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-label">
        <span>{loadLabel(stage)}…</span>
        <span>{`Step ${step} of ${LOAD_STAGES.length - 1}`}</span>
      </div>
      <progress max={100} value={percent} aria-label="Loading progress" />
    </div>
  );
}

interface MenuProps {
  state: Snapshot;
  started: boolean;
  error: string;
  stage: LoadStage;
  touchOnly: boolean;
  onPlay: () => void;
  onRecover: () => void;
  onRestart: () => void;
  settings: ReactNode;
}

function menuTitle(error: string, started: boolean): string {
  if (error) return 'The city needs a restart.';
  return started ? 'Take a breath.' : 'The city is yours.';
}

function menuCopy(error: string, started: boolean): string {
  if (error) return error;
  if (started) return 'Your drive will be waiting.';
  return 'Rain on the asphalt. Neon in the rear-view.\nFind your ride and disappear into the night.';
}

function primaryLabel(state: Snapshot, started: boolean, error: string): string {
  if (error) return 'Reload game';
  if (!state.ready) return 'Building the city…';
  return started ? 'Resume drive' : 'Enter Sumo World';
}

function Menu(props: MenuProps) {
  const { state, started, error, stage, touchOnly, onPlay, onRecover, onRestart, settings } = props;
  const loading = !error && !state.ready;
  return (
    <div className={`overlay ${started ? 'paused' : ''}`}>
      <div className="menu">
        <div className="menu-brand">SUMO<span>WORLD</span></div>
        <div className="menu-rule" />
        <h1>{menuTitle(error, started)}</h1>
        <p>{menuCopy(error, started)}</p>
        {touchOnly && (
          <div className="touch-notice" role="note">
            <strong>Desktop only for now.</strong> Sumo World needs a keyboard and mouse or a
            standard gamepad. Touch controls are not supported yet.
          </div>
        )}
        {loading && <LoadingStatus stage={stage} />}
        <button
          type="button"
          className="primary"
          onClick={error ? () => window.location.reload() : onPlay}
          disabled={loading}
          autoFocus={started}
        >
          {primaryLabel(state, started, error)}
          <span aria-hidden="true">↗</span>
        </button>
        {started && !error && (
          <div className="menu-actions">
            <button type="button" onClick={onRecover}>Recover at garage</button>
            <button type="button" onClick={onRestart}>Restart mission</button>
          </div>
        )}
        {!error && settings}
        <div className="menu-help">
          <span><kbd>W A S D</kbd> Move / drive</span>
          <span><kbd>F</kbd> Enter / exit</span>
          <span><kbd>MOUSE</kbd> Click scene to look</span>
        </div>
        <small className="desktop-note">Desktop game · Keyboard + mouse or standard gamepad</small>
      </div>
      <div className="edition">HIKARI DISTRICT<span>AFTER DARK</span></div>
    </div>
  );
}

export default function Page() {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const applied = useRef(false);
  const [api, setApi] = useState<Runtime | null>(null);
  const [state, setState] = useState<Snapshot>(initialSnapshot);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const [stage, setStage] = useState<LoadStage>('download');
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [touchOnly, setTouchOnly] = useState(false);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    const match = (query: string) => window.matchMedia(query).matches;
    const reducedMotion = match('(prefers-reduced-motion: reduce)');
    setSettings(loadSettings(browserStorage(), defaultSettings(reducedMotion)));
    setTouchOnly(isTouchOnly(match));
    setDebug(debugRequested(window.location.search));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let instance: Runtime | undefined;
    const boot = async () => {
      const { Runtime: Game } = await import('../game/core/runtime');
      if (cancelled || !host.current) return;
      setStage('graphics');
      await nextFrame();
      if (cancelled || !host.current) return;
      instance = new Game(host.current, setState, setError);
      runtime.current = instance;
      setApi(instance);
      setStage('city');
      await instance.initialise();
      if (!cancelled) setStage('ready');
    };
    boot().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load the city');
    });
    return () => {
      cancelled = true;
      instance?.dispose();
      runtime.current = null;
      applied.current = false;
    };
  }, []);

  useEffect(() => {
    const game = runtime.current;
    if (!state.ready || !game || !settings || applied.current) return;
    applied.current = true;
    if (settings.quality !== state.quality) game.setQuality(settings.quality);
    if (settings.adaptiveResolution !== state.adaptiveResolution) {
      game.setAdaptiveResolution(settings.adaptiveResolution);
    }
    if (settings.weather !== state.weatherSetting) game.setWeather(settings.weather);
    if (settings.lowMotion !== state.lowMotion) game.toggleMotion();
  }, [state.ready, state.quality, state.adaptiveResolution, state.weatherSetting, state.lowMotion, settings]);

  const remember = (patch: Partial<GameSettings>) => {
    const next = { ...(settings ?? defaultSettings()), ...patch };
    setSettings(next);
    saveSettings(browserStorage(), next);
  };

  /** Web Audio can be missing or blocked; the game stays playable without sound. */
  const flipSound = (game: Runtime): boolean => {
    try {
      game.toggleSound();
      return true;
    } catch {
      return false;
    }
  };

  const play = () => {
    const game = runtime.current;
    if (!game) return;
    setStarted(true);
    game.start();
    // Browsers only allow audio to start from a user gesture, so a saved "sound on" is
    // restored here rather than when the city finishes loading.
    if (settings?.sound && !state.sound) flipSound(game);
  };

  const changeQuality = (preset: QualityPreset) => {
    runtime.current?.setQuality(preset);
    remember({ quality: preset });
  };

  const toggleAdaptiveResolution = () => {
    const enabled = !state.adaptiveResolution;
    runtime.current?.setAdaptiveResolution(enabled);
    remember({ adaptiveResolution: enabled });
  };

  const changeWeather = (setting: WeatherSetting) => {
    runtime.current?.setWeather(setting);
    remember({ weather: setting });
  };

  const toggleLowMotion = () => {
    runtime.current?.toggleMotion();
    remember({ lowMotion: !state.lowMotion });
  };

  const toggleSound = () => {
    const game = runtime.current;
    if (game && flipSound(game)) remember({ sound: !state.sound });
  };

  const showMenu = !started || state.paused || Boolean(error);
  const classes = ['game'];
  if (state.lowMotion) classes.push('low-motion');

  return (
    <main
      className={classes.join(' ')}
      data-fps={Math.round(state.fps)}
      data-x={state.x.toFixed(2)}
      data-z={state.z.toFixed(2)}
      data-ready={state.ready ? 'true' : 'false'}
    >
      <div className="viewport" ref={host} aria-label="Sumo World 3D game" />
      <div className="vignette" />
      {started && !error && <Hud state={state} onPause={() => runtime.current?.pause()} />}
      {debug && <DebugOverlay api={api} state={state} />}
      {showMenu && (
        <Menu
          state={state}
          started={started}
          error={error}
          stage={stage}
          touchOnly={touchOnly}
          onPlay={play}
          onRecover={() => runtime.current?.recover()}
          onRestart={() => runtime.current?.restart()}
          settings={
            <SettingsPanel
              state={state}
              onQuality={changeQuality}
              onAdaptiveResolution={toggleAdaptiveResolution}
              onWeather={changeWeather}
              onLowMotion={toggleLowMotion}
              onSound={toggleSound}
            />
          }
        />
      )}
    </main>
  );
}
