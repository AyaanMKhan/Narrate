export interface ToggleProps {
  /** Current on/off value. */
  checked: boolean;
  /** Called with the next value when the user flips the switch. */
  onChange: (next: boolean) => void;
  /** Accessible name — the visible row label. */
  label: string;
  /** Optional id of the element describing the switch. */
  describedBy?: string;
  disabled?: boolean;
}

/** An accessible sliding switch built on a real button[role=switch]. */
export default function Toggle({
  checked,
  onChange,
  label,
  describedBy,
  disabled = false,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className="n-toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="n-toggle__knob" aria-hidden="true" />
    </button>
  );
}
