import type { Snapshot } from '../game/core/types';
import { REDLINE_RPM } from '../game/vehicle/drivetrain';
import { formatGear, rpmFraction, weatherLabel } from './settings';

/** Map scale: SVG units per world metre, centred on the district origin. */
const MAP_SCALE = 0.42;
const MAP_CENTRE = 90;
const RPM_SEGMENTS = 24;
/** Segments from this share of the rev range upwards are drawn in the redline colour. */
const REDLINE_SHARE = 0.85;

function Minimap({ state }: { state: Snapshot }) {
  const x = MAP_CENTRE + state.x * MAP_SCALE;
  const z = MAP_CENTRE + state.z * MAP_SCALE;
  const heading = (-state.yaw * 180) / Math.PI;
  return (
    <div className="minimap">
      <svg viewBox="0 0 180 180" role="img" aria-label="District map showing your position and the destination">
        <defs>
          <pattern id="streets" width="25.2" height="25.2" x="1.8" y="1.8" patternUnits="userSpaceOnUse">
            <rect width="25.2" height="25.2" fill="#182735" />
            <rect x="4" y="4" width="17.2" height="17.2" fill="#080f1b" />
          </pattern>
        </defs>
        <rect width="180" height="180" fill="url(#streets)" />
        <path d="M91.68 100.08 L91.68 46.32" stroke="#55e9da" strokeWidth="2" fill="none" opacity=".8" />
        <circle cx="91.68" cy="46.32" r="4" fill="none" stroke="#65ffca" strokeWidth="2" />
        <g transform={`translate(${x} ${z}) rotate(${heading})`}>
          <path d="M0 6 L-4 -4 L0 -2 L4 -4 Z" fill="white" />
        </g>
      </svg>
      <span>N</span>
      <small>HIKARI DISTRICT</small>
    </div>
  );
}

function RevCounter({ rpm, gear }: { rpm: number; gear: number }) {
  const lit = Math.round(rpmFraction(rpm, REDLINE_RPM) * RPM_SEGMENTS);
  const redlineFrom = Math.floor(RPM_SEGMENTS * REDLINE_SHARE);
  const segments = Array.from({ length: RPM_SEGMENTS }, (_, i) => {
    const classes = ['rpm-segment'];
    if (i < lit) classes.push('on');
    if (i >= redlineFrom) classes.push('red');
    return <i key={i} className={classes.join(' ')} />;
  });
  return (
    <div className="rev-counter">
      <div
        className="rpm-bar"
        role="meter"
        aria-label="Engine speed"
        aria-valuemin={0}
        aria-valuemax={REDLINE_RPM}
        aria-valuenow={Math.round(rpm)}
        aria-valuetext={`${Math.round(rpm)} rpm`}
      >
        {segments}
      </div>
      <div className="gear">
        <small>GEAR</small>
        {formatGear(gear)}
      </div>
      <span className="rpm-readout">{(rpm / 1000).toFixed(1)}k RPM</span>
    </div>
  );
}

function missionTitle(state: Snapshot): string {
  if (state.mission === 'enter') return 'Your night starts here.';
  if (state.mission === 'complete') return 'Destination reached.';
  return state.distance < 5 ? 'Stop in the marked area.' : 'Drive to the transit terminal.';
}

function missionDetail(state: Snapshot): string {
  if (state.mission === 'enter') return 'Approach the silver coupe. Press F to enter.';
  if (state.mission === 'complete') return 'Keep exploring. Every street is yours.';
  return `${Math.round(state.distance)} m to destination · Follow the cyan road markers`;
}

function missionStep(state: Snapshot): string {
  if (state.mission === 'enter') return '01 / 03';
  if (state.mission === 'complete') return '03 / 03';
  return '02 / 03';
}

function Controls({ driving }: { driving: boolean }) {
  return (
    <footer className="controls">
      <span><kbd>W A S D</kbd>{driving ? 'Drive' : 'Walk'}</span>
      <span><kbd>{driving ? 'SPACE' : 'SHIFT'}</kbd>{driving ? 'Handbrake' : 'Sprint'}</span>
      <span><kbd>{driving ? 'C' : 'V'}</kbd>{driving ? 'Look behind' : 'Camera'}</span>
      <span><kbd>R</kbd>Recover</span>
      <span><kbd>ESC</kbd>Pause · Settings</span>
    </footer>
  );
}

export function Hud({ state, onPause }: { state: Snapshot; onPause: () => void }) {
  const weather = weatherLabel(state.weather).toUpperCase();
  const auto = state.weatherSetting === 'auto';
  return (
    <>
      <header className="top">
        <a className="wordmark" href="/" aria-label="Sumo World home">
          SUMO<span>WORLD</span>
        </a>
        <div className="weather">
          <i className={`weather-dot ${state.weather}`} />
          <span>
            {weather}
            {auto && <em>AUTO</em>}
          </span>
          <b>HIKARI / NIGHT</b>
          <button type="button" onClick={onPause} aria-label="Pause game and open settings">Ⅱ</button>
        </div>
      </header>

      <section className="mission">
        <div className="mission-meta">
          <span className="diamond" />
          {state.mission === 'complete' ? 'MISSION COMPLETE' : 'NIGHT DRIVE'}
          <span>{missionStep(state)}</span>
        </div>
        <h1>{missionTitle(state)}</h1>
        <p>{missionDetail(state)}</p>
        {state.hold > 0 && state.mission !== 'complete' && (
          <progress max="1" value={state.hold} aria-label="Stopping at destination" />
        )}
      </section>

      <Minimap state={state} />

      <div className="speed">
        <span>{state.driving ? 'SUMO GT' : state.firstPerson ? 'FIRST PERSON' : 'ON FOOT'}</span>
        <div className="speed-value">
          {state.driving ? Math.round(state.speed).toString().padStart(3, '0') : '—'}
          <small>{state.driving ? 'KM/H' : 'EXPLORE'}</small>
        </div>
        {state.driving ? (
          <RevCounter rpm={state.rpm} gear={state.gear} />
        ) : (
          <div className="speed-line" aria-hidden="true" />
        )}
      </div>

      {state.prompt && (
        <div className="prompt"><kbd>F</kbd>{state.prompt}</div>
      )}
      {state.notice && (
        <div className="notice" role="status">{state.notice}</div>
      )}
      <Controls driving={state.driving} />
    </>
  );
}
