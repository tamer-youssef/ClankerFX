import { memo, useRef, useState, type DragEvent } from 'react';
import { getEffectDefinition } from '../../effects/registry';
import { useApp } from '../../state/AppContext';
import type { EffectState } from '../../types/effects';
import { CloseIcon } from '../common/icons';
import { Slider } from '../common/Slider';
import { ParamControl } from './ParamControl';
import './EffectCard.css';

export type DropIndicator = 'before' | 'after' | null;

interface EffectCardProps {
  effect: EffectState;
  index: number;
  count: number;
  bypassed: boolean;
  dragging: boolean;
  dropIndicator: DropIndicator;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, index: number) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export const EffectCard = memo(function EffectCard({
  effect,
  index,
  count,
  bypassed,
  dragging,
  dropIndicator,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: EffectCardProps) {
  const { dispatch } = useApp();
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const definition = getEffectDefinition(effect.type);
  if (!definition) return null;

  const advancedId = `advanced-${effect.id}`;
  const move = (toIndex: number) => dispatch({ type: 'chain/move', fromIndex: index, toIndex });
  const classes = ['effect-card'];
  if (!effect.enabled) classes.push('effect-card--off');
  if (bypassed) classes.push('effect-card--bypassed');
  if (dragging) classes.push('effect-card--dragging');
  if (dropIndicator) classes.push(`effect-card--drop-${dropIndicator}`);

  return (
    <article
      ref={cardRef}
      className={classes.join(' ')}
      aria-label={`${definition.label} effect`}
      onDragOver={(event) => onDragOver(event, index)}
      onDrop={onDrop}
    >
      <header className="effect-card__header">
        <button
          type="button"
          className="effect-card__grip"
          draggable
          aria-label={`Drag to reorder ${definition.label}`}
          title="Drag to reorder"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/x-mechvox-effect', effect.id);
            if (cardRef.current) event.dataTransfer.setDragImage(cardRef.current, 16, 16);
            onDragStart(effect.id);
          }}
          onDragEnd={onDragEnd}
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
            {[3, 8, 13].map((y) => (
              <g key={y}>
                <circle cx="2" cy={y} r="1.3" />
                <circle cx="8" cy={y} r="1.3" />
              </g>
            ))}
          </svg>
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={effect.enabled}
          className="effect-card__power"
          onClick={() => dispatch({ type: 'chain/setEnabled', id: effect.id, enabled: !effect.enabled })}
          title={effect.enabled ? 'Turn off' : 'Turn on'}
        >
          <span className="effect-card__led" aria-hidden="true" />
          <span className="effect-card__title">{definition.label}</span>
          <span className="effect-card__state">{effect.enabled ? 'ON' : 'OFF'}</span>
        </button>

        <div className="effect-card__tools">
          <button
            type="button"
            className="btn btn--small"
            aria-pressed={bypassed}
            onClick={() => dispatch({ type: 'bypass/toggleEffect', id: effect.id })}
            title="A/B: hear the voice without this effect (not saved)"
          >
            Bypass
          </button>
          <button type="button" className="icon-btn" aria-label={`Move ${definition.label} up`} disabled={index === 0} onClick={() => move(index - 1)}>
            ▲
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Move ${definition.label} down`}
            disabled={index === count - 1}
            onClick={() => move(index + 1)}
          >
            ▼
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove ${definition.label}`}
            title="Remove effect"
            onClick={() => dispatch({ type: 'chain/remove', id: effect.id })}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="effect-card__amount">
        <Slider
          label="Amount"
          size="large"
          position={effect.amount}
          valueText={`${Math.round(effect.amount * 100)}%`}
          onPositionChange={(amount) => dispatch({ type: 'chain/setAmount', id: effect.id, amount, at: performance.now() })}
        />
      </div>

      <button
        type="button"
        className="effect-card__advanced-toggle"
        aria-expanded={expanded}
        aria-controls={advancedId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> Advanced
      </button>

      {expanded && (
        <div id={advancedId} className="effect-card__advanced">
          <p className="effect-card__hint">{definition.description} Amount scales these settings: 0% is transparent, 100% is exactly what is set here.</p>
          {Object.entries(definition.params).map(([key, spec]) => (
            <ParamControl
              key={key}
              spec={spec}
              value={effect.params[key] ?? spec.default}
              onChange={(value) => dispatch({ type: 'chain/setParam', id: effect.id, key, value, at: performance.now() })}
            />
          ))}
        </div>
      )}
    </article>
  );
});

