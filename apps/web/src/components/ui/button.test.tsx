import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('is a real button that never submits forms by accident', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('type')).toBe('button');
  });

  it('lets later classes override variant styles', () => {
    render(
      <Button variant="outline" className="h-12">
        Wide
      </Button>,
    );
    const className = screen.getByRole('button', { name: 'Wide' }).className;
    expect(className).toContain('h-12');
    expect(className).not.toContain('h-10');
  });
});
