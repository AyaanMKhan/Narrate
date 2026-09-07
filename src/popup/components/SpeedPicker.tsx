import { SPEEDS } from '@/shared/constants';

export interface SpeedPickerProps {
  /** Currently active playback rate. */
  value: number;
  /** Called with the chosen rate; must apply to in-flight playback. */
  onChange: (rate: number) => void;
}

/** "1", "1.25", "0.5" — never "1.0". */
export function formatSpeed(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/** Horizontal segmented control over every value in SPEEDS. */
export default function SpeedPicker({ value, onChange }: SpeedPickerProps) {
  return (
    <section className="n-section">
      <div className="n-section__head">
        <h2 className="n-label">Speed</h2>
        <span className="n-label__value">{formatSpeed(value)}</span>
      </div>
      <div className="n-segments" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((speed) => {
          const active = Math.abs(speed - value) < 0.001;
          return (
            <button
              key={speed}
              type="button"
              role="radio"
              aria-checked={active}
              className={`n-segment${active ? ' is-active' : ''}`}
              onClick={() => onChange(speed)}
            >
              {formatSpeed(speed)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
