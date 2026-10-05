import './EffectRack.css';

/** Placeholder until the effect chain lands (Phase 2). Intentionally has no fake controls. */
export function EffectRack() {
  return (
    <section className="rack" aria-labelledby="rack-title">
      <div className="rack__head">
        <h2 id="rack-title" className="panel-title">
          Effect chain
        </h2>
        <button type="button" className="btn" disabled title="Available in a later build phase">
          + Add Effect
        </button>
      </div>
      <div className="rack__empty">
        <p>No effects yet.</p>
        <p className="rack__hint">Effect modules, Amount sliders and presets arrive in the next build phases.</p>
      </div>
    </section>
  );
}
