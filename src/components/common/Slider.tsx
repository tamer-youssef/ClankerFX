import { useId } from 'react';
import './Slider.css';

interface SliderProps {
  label: string;
  /** Normalised 0–1 position; mapping to real values (linear/log/step) is the caller's job. */
  position: number;
  valueText: string;
  onPositionChange: (position: number) => void;
  size?: 'large' | 'small';
  disabled?: boolean;
}

const RESOLUTION = 1000;

export function Slider({ label, position, valueText, onPositionChange, size = 'small', disabled }: SliderProps) {
  const id = useId();
  const percent = Math.round(position * 100);
  return (
    <div className={`slider slider--${size}`}>
      <label htmlFor={id} className="slider__label">
        {label}
      </label>
      <input
        id={id}
        className="slider__input"
        type="range"
        min={0}
        max={RESOLUTION}
        step={1}
        value={Math.round(position * RESOLUTION)}
        disabled={disabled}
        aria-valuetext={valueText}
        style={{ '--fill': `${percent}%` } as React.CSSProperties}
        onChange={(event) => onPositionChange(Number(event.target.value) / RESOLUTION)}
      />
      <output htmlFor={id} className="slider__value">
        {valueText}
      </output>
    </div>
  );
}
