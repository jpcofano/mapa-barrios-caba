import { describe, it, expect } from 'vitest';
import drawVisualization from './Visualization';

describe('drawVisualization', () => {
  it('should be a function', () => {
    expect(typeof drawVisualization).toBe('function');
  });
});