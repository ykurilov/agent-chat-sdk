import { describe, expect, it } from 'vitest';
import { scopeEmbeddedCss } from '../embedded.config.mjs';

describe('embedded CSS target scoping', () => {
  it('restricts resets, utility selectors, generated pseudo elements, roots and theme tokens', () => {
    const css=scopeEmbeddedCss(':root{--x:1}body{margin:0}button,h1{font:inherit}*::before{border:0}.dark{--x:2}[data-theme="dark"]{--x:3}.flex{display:flex}');
    expect(css).not.toContain(':root');
    expect(css).not.toContain('body{');
    expect(css).toContain('.oduvanchik-chat');
    expect(css).toContain('[data-agent-chat-oduvanchik]');
    expect(css).toContain('*)::before');
    expect(css).toContain('.dark :where(.oduvanchik-chat');
    expect(css).toContain('[data-theme="dark"] :where(.oduvanchik-chat');
  });
  it('respects explicit host themes before system fallback', () => {
    const css=scopeEmbeddedCss(':root[data-theme="dark"]{color-scheme:dark}@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark}}');
    expect(css).toContain(':is([data-theme="dark"],[data-theme="dark"] *)');
    expect(css).toContain(':not([data-theme="light"],[data-theme="light"] *)');
  });
  it('preserves keyframe steps and conditional nesting', () => {
    const css=scopeEmbeddedCss('@keyframes pulse{0%{opacity:0}to{opacity:1}}@media(width>600px){.flex{display:flex}}');
    expect(css).toContain('@keyframes agent-chat-oduvanchik-pulse');
    expect(css).toContain('0%{opacity:0}');
    expect(css).toContain('to{opacity:1}');
    expect(css).toContain('@media(width>600px){.flex:is(');
  });
});

 it('namespaces shared Tailwind properties, layers and animation references', () => {
  const css=scopeEmbeddedCss('@layer base,utilities;@property --tw-x{syntax:"*";inherits:false}.spin{--tw-x:1;--animate-spin:spin 1s linear;animation:spin 1s}@keyframes spin{to{transform:rotate(360deg)}}');
  expect(css).not.toContain('@layer');
  expect(css).not.toContain('--tw-x');
  expect(css).toContain('--agent-chat-oduvanchik-tw-x');
  expect(css).toContain('animation:agent-chat-oduvanchik-spin 1s');
  expect(css).toContain('--animate-spin:agent-chat-oduvanchik-spin 1s linear');
 });

 it('keeps bundled font definitions separate from host fonts', () => {
  const css=scopeEmbeddedCss('@font-face{font-family:"ExampleFont";src:url(font.woff2)}:root{font-family:"ExampleFont",sans-serif}');
  expect(css).toContain('font-family:"agent-chat-oduvanchik-ExampleFont"');
  expect(css).not.toContain('font-family:"ExampleFont"');
 });

 it('keeps legacy pseudo-elements and selector-list whitespace valid', () => {
  const css=scopeEmbeddedCss('*, :before, :after, ::backdrop{box-sizing:border-box}');
  expect(css).not.toContain(':before:is(');
  expect(css).not.toContain(':after:is(');
  expect(css).toContain('*)::backdrop');
 });

 it('inherits host body typography instead of reinstalling a scoped default', () => {
  const css=scopeEmbeddedCss(':root{--yk-studio-body-size:15px;--yk-studio-body-line-height:1.8}.local{--yk-studio-body-size:14px}');
  expect(css).toContain('--yk-studio-body-size:inherit');
  expect(css).toContain('--yk-studio-body-size:14px');
  expect(css).toContain('--yk-studio-body-line-height:1.8');
 });
