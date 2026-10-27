import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const scope = ':where(.oduvanchik-chat,[data-agent-chat-oduvanchik])';
const inside = ':is(.oduvanchik-chat,.oduvanchik-chat *,[data-agent-chat-oduvanchik],[data-agent-chat-oduvanchik] *)';

/** Restrict each selector's target, including universal resets, to skin-owned DOM.
 * Ancestor theme selectors still work. Keyframe steps are not DOM selectors. */
export function scopeEmbeddedCss(css) {
  const root = postcss.parse(css.replaceAll('--tw-', '--agent-chat-oduvanchik-tw-'));
  // Definitions have document-wide names even when every DOM selector is scoped.
  // Keep their names separate from the host's Tailwind and component animations.
  const names = new Map();
  const fonts = new Map();
  root.walkAtRules(rule => {
    if (/keyframes$/i.test(rule.name)) {
      const old = rule.params.trim();
      const renamed = `agent-chat-oduvanchik-${old}`;
      names.set(old, renamed);
      rule.params = renamed;
    }
    if (rule.name === 'font-face') {
      rule.walkDecls('font-family', decl => {
        const family = decl.value.replace(/^["']|["']$/g, '');
        fonts.set(family, `agent-chat-oduvanchik-${family}`);
      });
    }

  });
  root.walkDecls(decl => {
    if (decl.prop === 'font' || decl.prop === 'font-family' || decl.prop.startsWith('--font-')) {
      for (const [name, renamed] of fonts) decl.value = decl.value.replaceAll(name, renamed);
    }
    if (decl.prop.includes('animation') || decl.prop.startsWith('--animate-')) {
      decl.value = decl.value.replace(/[\w-]+/g, word => names.get(word) ?? word);
    }
  });
  // Flatten the isolated layers: unlayered host element styles otherwise outrank
  // Tailwind utilities even when the skin is loaded later. The generated layer
  // order is preserved, followed by the skin's explicit overrides.
  root.walkAtRules('layer', rule => {
    if (rule.nodes) rule.replaceWith(...rule.nodes);
    else rule.remove();
  });
  root.prepend(postcss.parse(`${scope} * { font-family: inherit; }`).nodes);
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    const selectors = selectorParser().astSync(rule.selector);
    const output = [];
    for (const selector of selectors.nodes) {
      const original = selector.toString().trim();
      if (/^(\.dark|\[data-theme=["']?dark["']?\])$/.test(original)) {
        output.push(`${original} ${scope}`, `${scope}${original}`);
        continue;
      }
      const rootTheme = original.match(/^:root(\.dark|\[data-theme(?:=["']?(?:dark|light)["']?)?\])$/);
      if (rootTheme) {
        output.push(`${scope}:is(${rootTheme[1]},${rootTheme[1]} *)`);
        continue;
      }
      // A system-theme root condition must still observe an explicit LIGHT host ancestor.
      if (original === ':root:not([data-theme="light"])') {
        output.push(`${scope}:not([data-theme="light"],[data-theme="light"] *)`);
        continue;
      }
      selector.walkPseudos(node => {
        if (node.value === ':root') node.replaceWith(selectorParser.pseudo({ value: scope }));
      });
      selector.walkTags(node => {
        if (node.value === 'html' || node.value === 'body') node.replaceWith(selectorParser.pseudo({ value: scope }));
      });
      // Scope the target compound before ::before/after/selection, never its generated pseudo-element.
      let anchor;
      for (const node of selector.nodes) {
        if (node.type === 'combinator') anchor = undefined;
        else if (!anchor && node.type === 'pseudo' && (node.value.startsWith('::') || [':before', ':after', ':first-line', ':first-letter'].includes(node.value))) anchor = node;
      }
      const guard = selectorParser.pseudo({ value: inside });
      if (anchor) {
        guard.spaces.before = anchor.spaces.before;
        anchor.spaces.before = '';
        selector.insertBefore(anchor, guard);
      }
      else selector.append(guard);
      output.push(selector.toString());
    }
    rule.selector = output.join(',');
  });
  return root.toString();
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tailwindcss(), {
    name: 'scope-embedded-skin',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const [key, asset] of Object.entries(bundle)) {
        if (asset.type === 'chunk') { delete bundle[key]; continue; }
        if (asset.type === 'asset' && asset.fileName.endsWith('.css')) asset.source = scopeEmbeddedCss(String(asset.source));
      }
    },
  }],
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    cssMinify: false,
    lib: { entry: fileURLToPath(new URL('embedded-entry.mjs', import.meta.url)), formats: ['es'], cssFileName: 'embedded' },
  },
});
