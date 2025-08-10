
import { describe, it, expect, vi } from 'vitest';

vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => ({ setView: vi.fn().mockReturnThis(), addTo: vi.fn() })),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    geoJSON: vi.fn(() => ({ addTo: vi.fn() }))
  }
}));

import drawVisualization from './Visualization';

describe('drawVisualization', () => {
  it('should be a function', () => {
    expect(typeof drawVisualization).toBe('function');
  });
});