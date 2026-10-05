/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so the deploy script builds with BASE_PATH=/<repo>/. Local dev uses '/'.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  test: {
    // DSP/state logic is tested without a DOM; Web Audio objects are never touched in unit tests.
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
