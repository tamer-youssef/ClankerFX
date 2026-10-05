export function UnsupportedBrowser() {
  return (
    <main style={{ maxWidth: 520, margin: '12vh auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>This browser can't run ClankerFX</h1>
      <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        ClankerFX needs the Web Audio API to process sound locally on your device. Please use a current version of Chrome, Edge, Firefox or
        Safari.
      </p>
    </main>
  );
}
