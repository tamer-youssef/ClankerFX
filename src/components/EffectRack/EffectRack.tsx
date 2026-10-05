import { useState, type DragEvent } from 'react';
import { useApp } from '../../state/AppContext';
import { AddEffectMenu } from './AddEffectMenu';
import { EffectCard, type DropIndicator } from './EffectCard';
import './EffectRack.css';

export function EffectRack() {
  const { state, dispatch } = useApp();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** Insertion position among the current cards, 0..count. */
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const reset = () => {
    setDraggingId(null);
    setDropIndex(null);
  };

  const onDragOver = (event: DragEvent<HTMLElement>, index: number) => {
    if (!draggingId) return; // not one of our cards (e.g. a file being dragged)
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    setDropIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!draggingId || dropIndex === null) return;
    event.preventDefault();
    const fromIndex = state.chain.findIndex((effect) => effect.id === draggingId);
    // Removing the dragged card shifts later insertion points down by one.
    const toIndex = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
    if (fromIndex >= 0) dispatch({ type: 'chain/move', fromIndex, toIndex });
    reset();
  };

  const indicatorFor = (index: number): DropIndicator => {
    if (dropIndex === null || !draggingId) return null;
    if (dropIndex === index) return 'before';
    if (dropIndex === state.chain.length && index === state.chain.length - 1) return 'after';
    return null;
  };

  return (
    <section className="rack" aria-labelledby="rack-title">
      <div className="rack__head">
        <h2 id="rack-title" className="panel-title">
          Effect chain <span className="rack__count">{state.chain.length > 0 ? `· ${state.chain.length}` : ''}</span>
        </h2>
        <AddEffectMenu />
      </div>

      {state.chain.length === 0 ? (
        <div className="rack__empty">
          <p>No effects yet.</p>
          <p className="rack__hint">Add a Ring Modulator, Distortion or Filter to start building a robot voice. Effects run top to bottom.</p>
        </div>
      ) : (
        <div className="rack__list">
          {state.chain.map((effect, index) => (
            <EffectCard
              key={effect.id}
              effect={effect}
              index={index}
              count={state.chain.length}
              bypassed={state.bypassedIds.includes(effect.id)}
              dragging={draggingId === effect.id}
              dropIndicator={indicatorFor(index)}
              onDragStart={setDraggingId}
              onDragEnd={reset}
              onDragOver={onDragOver}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </section>
  );
}
