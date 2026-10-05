/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // DSP/state logic is tested without a DOM; Web Audio objects are never touched in unit tests.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
