/** Use the host's patch algorithm and YAML dialect; expression nodes remain unevaluated. */
import path from 'node:path';
import { load } from 'js-yaml';
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { isObject, readText } from './packages.mjs';

export function dynamic(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (Object.hasOwn(value, '__jsExpr')) return true;
  seen.add(value);
  return Object.values(value).some(child => dynamic(child, seen));
}

function validate(rows, patch, file, ancestors = new Set()) {
  if (!Array.isArray(rows) || ancestors.has(rows)) throw new Error('expected an acyclic entry/patch array');
  if (ancestors.size > 50 || rows.length > 10000) throw new Error('configuration exceeds static scan limits');
  ancestors = new Set(ancestors).add(rows);
  for (const row of rows) {
    if (!isObject(row)) throw new Error('entry/patch must be an object');
    for (const key of ['id', 'name']) {
      if (Object.hasOwn(row, key) && typeof row[key] !== 'string' && !dynamic(row[key])) throw new Error(`${key} must be a string`);
    }
    for (const key of ['disabled', 'group']) {
      if (Object.hasOwn(row, key) && row[key] !== null && typeof row[key] !== 'boolean' && !dynamic(row[key])) throw new Error(`${key} must be boolean or null`);
    }
    if (row.insert !== undefined) {
      if (!patch) throw new Error('insert belongs in a patch list');
      validate(row.insert, false, file, ancestors);
    } else if (!patch) {
      row._phc_source = file;
      if (row.name?.startsWith('.')) row.name = path.resolve(path.dirname(file), row.name);
      if (row.name === 'cordis:group') row.group = true;
      if (row.group === true && !dynamic(row.config)) validate(row.config, false, file, ancestors);
    }
  }
  return rows;
}

export function readList(file, patch = true) {
  // A parse error's YAML snippet may contain credentials. Never return the exception text.
  try {
    return validate(load(readText(file), { schema: entryListSchema }) ?? [], patch, file);
  } catch {
    throw new Error('invalid YAML/JSON entry list or field types');
  }
}

export function compose(entries, patches, warn) {
  // Do not let expression-valued selectors accidentally become patch-map keys.
  const literal = patches.filter(patch => !dynamic(patch.id) && !isObject(patch.insert));
  if (literal.length !== patches.length) warn('dynamic patch selector or insertion was not evaluated');
  return applyEntryPatches(entries, literal, message => warn(message.replaceAll('%C', '<entry>')));
}
