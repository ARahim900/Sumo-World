import type { QualityPreset, Snapshot, WeatherSetting } from '../game/core/types';
import { QUALITY_PRESETS } from '../game/render/quality';
import { WEATHER_SETTINGS, qualityLabel, weatherLabel } from './settings';

interface SettingsPanelProps {
  state: Snapshot;
  onQuality: (preset: QualityPreset) => void;
  onAdaptiveResolution: () => void;
  onWeather: (setting: WeatherSetting) => void;
  onLowMotion: () => void;
  onSound: () => void;
}

interface ChoiceGroupProps<T extends string> {
  name: string;
  legend: string;
  options: readonly T[];
  value: T;
  label: (option: T) => string;
  disabled: boolean;
  onChange: (option: T) => void;
}

function ChoiceGroup<T extends string>(props: ChoiceGroupProps<T>) {
  const { name, legend, options, value, label, disabled, onChange } = props;
  return (
    <fieldset className="choice-group" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="choices">
        {options.map(option => (
          <label key={option} className={option === value ? 'choice selected' : 'choice'}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
            />
            {label(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle(props: { label: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const { label, checked, disabled, onToggle } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="toggle"
      disabled={disabled}
      onClick={onToggle}
    >
      {label}
      <b aria-hidden="true">{checked ? 'ON' : 'OFF'}</b>
    </button>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { state, onQuality, onAdaptiveResolution, onWeather, onLowMotion, onSound } = props;
  const disabled = !state.ready;
  return (
    <section className="settings-panel" aria-label="Settings">
      <ChoiceGroup
        name="quality"
        legend="Quality"
        options={QUALITY_PRESETS}
        value={state.quality}
        label={qualityLabel}
        disabled={disabled}
        onChange={onQuality}
      />
      <ChoiceGroup
        name="weather"
        legend="Weather"
        options={WEATHER_SETTINGS}
        value={state.weatherSetting}
        label={weatherLabel}
        disabled={disabled}
        onChange={onWeather}
      />
      <div className="toggles">
        <Toggle
          label="Auto resolution"
          checked={state.adaptiveResolution}
          disabled={disabled}
          onToggle={onAdaptiveResolution}
        />
        <Toggle label="Low motion" checked={state.lowMotion} disabled={disabled} onToggle={onLowMotion} />
        <Toggle label="Engine audio" checked={state.sound} disabled={disabled} onToggle={onSound} />
      </div>
    </section>
  );
}
