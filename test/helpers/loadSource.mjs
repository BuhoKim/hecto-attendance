import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import swc from 'next/dist/build/swc/index.js';

await swc.loadBindings();
const nativeRequire = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../..');

// Execute application modules with only network/framework boundaries replaced.
export function sourceLoader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    let path = resolve(root, file);
    if (!existsSync(path)) path += '.js';
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const { code } = swc.transformSync(readFileSync(path, 'utf8'), {
      filename: path,
      jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022' },
      module: { type: 'commonjs' },
    });
    const require = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}`);
      if (name.startsWith('.')) return load(resolve(dirname(path), name));
      return nativeRequire(name);
    };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
      require, module, module.exports, ...Object.values(globals),
    );
    return module.exports;
  }
  return load;
}

export function memoryDb(tables) {
  return {
    from(table) {
      let predicates = [], patch = null;
      const query = {
        select() { return query; },
        eq(key, value) { predicates.push(row => row[key] === value); return query; },
        in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
        order() { return query; },
        limit() { return query; },
        update(value) { patch = value; return query; },
        upsert(value) {
          const rows = tables[table] ||= [];
          const existing = rows.find(row => row.id === value.id);
          if (existing) Object.assign(existing, value); else rows.push({ ...value });
          return query;
        },
        async maybeSingle() { const result = await query; return { ...result, data: result.data[0] || null }; },
        single() { return query.maybeSingle(); },
        then(resolve) {
          const rows = (tables[table] || []).filter(row => predicates.every(p => p(row)));
          if (patch) rows.forEach(row => Object.assign(row, patch));
          return Promise.resolve({ data: rows.map(row => ({ ...row })), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}
