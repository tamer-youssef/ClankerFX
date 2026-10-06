/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served from the origin root (Vite dev server and the desktop app's app://clankerfx/ protocol).
  base: '/',
  plugins: [react()],
  test: {
    // DSP/state logic is tested without a DOM; Web Audio objects are never touched in unit tests.
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
