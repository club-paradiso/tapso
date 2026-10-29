import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore JavaScript boundary is exercised with hostile exports below.
import {validateSettings} from '../scripts/import-design.mjs';
const valid=()=>JSON.parse(readFileSync(new URL('../src/design/marketing.json',import.meta.url),'utf8'));
test('design export accepts current settings and strips unexpected input',()=>{const x=valid();x.secret='ignored';assert.equal(validateSettings(x).secret,undefined);});
test('design export rejects unreadable and injected colors without writing files',()=>{const x=valid();x.dark.ink=x.dark.bg;assert.throws(()=>validateSettings(x),/contrast/);const y=valid();y.light.bg='url(https://example.com)';assert.throws(()=>validateSettings(y),/Invalid/);});
test('design export rejects broken versions and blank copy',()=>{const x=valid();x.version=2;assert.throws(()=>validateSettings(x));const y=valid();y.copy.cta='';assert.throws(()=>validateSettings(y));});
