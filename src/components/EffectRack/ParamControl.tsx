import { useId } from 'react';
import type { ParamSpec } from '../../effects/BaseEffect';
import { formatParamValue, positionToValue, valueToPosition } from '../../utils/paramScale';
import { Slider } from '../common/Slider';

interface ParamControlProps {
  spec: ParamSpec;
  value: number;
  onChange: (value: number) => void;
}

/** One advanced parameter: a select for choices, otherwise a slider (log-aware, step-snapped). */
export function ParamControl({ spec, value, onChange }: ParamControlProps) {
  const selectId = useId();

  if (spec.options) {
    return (
      <div className="slider slider--small">
        <label htmlFor={selectId} className="slider__label">
          {spec.label}
        </label>
        <select id={selectId} className="select" value={value} onChange={(event) => onChange(Number(event.target.value))}>
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span />
      </div>
    );
  }

  return (
    <Slider
      label={spec.label}
      position={valueToPosition(spec, value)}
      valueText={formatParamValue(spec, value)}
      onPositionChange={(position) => onChange(positionToValue(spec, position))}
    />
  );
}
