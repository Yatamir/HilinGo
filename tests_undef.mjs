/**
 * HilinGo — fail if app JavaScript reads a name that was never declared.
 *   node tests_undef.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const BROWSER = `
window document navigator location performance localStorage sessionStorage fetch
Audio AudioContext webkitAudioContext speechSynthesis SpeechRecognition webkitSpeechRecognition
SpeechSynthesisUtterance MediaRecorder requestAnimationFrame cancelAnimationFrame
setTimeout setInterval clearTimeout clearInterval console alert URL URLSearchParams Blob File
Promise Map Set WeakMap WeakSet Math JSON Object Array String Number Boolean Date Error
RegExp parseInt parseFloat isNaN isFinite Infinity NaN undefined encodeURIComponent
decodeURIComponent encodeURI decodeURI btoa atob crypto indexedDB caches CustomEvent Event
Image HTMLElement Node MutationObserver IntersectionObserver ResizeObserver matchMedia
getComputedStyle queueMicrotask structuredClone BigInt Intl TextEncoder TextDecoder
AbortController FormData Headers Request Response WebSocket Worker OffscreenCanvas
CanvasRenderingContext2D Path2D DOMParser XMLHttpRequest history screen self globalThis
requestIdleCallback cancelIdleCallback performance origin event arguments
Function visualViewport TransformStream ReadableStream WritableStream CompressionStream
clients skipWaiting registration importScripts
Symbol Reflect Proxy ArrayBuffer DataView Float32Array Float64Array Int16Array Int32Array
Uint8Array Uint8ClampedArray Uint16Array Uint32Array BigInt64Array
webkitURL webkitRequestAnimationFrame
`.trim().split(/\s+/);

function scriptsOf(html){
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs) || /type\s*=\s*["']module["']/.test(attrs)) continue;
    if (body.trim()) out.push(body);
  }
  return out;
}

function localScripts(html){
  const out = [];
  const re = /<script\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/type\s*=\s*["']module["']/.test(attrs)) continue;
    const src = /src\s*=\s*["']([^"']+)["']/.exec(attrs);
    if (!src) continue;
    const file = src[1].split('?')[0];
    if (/^https?:/.test(file)) continue;
    out.push(file);
  }
  return out;
}

function declaredNames(ast){
  const names = new Set();
  function pat(node){
    if (!node) return;
    if (node.type === 'Identifier') names.add(node.name);
    else if (node.type === 'AssignmentPattern') pat(node.left);
    else if (node.type === 'ArrayPattern') node.elements.forEach(pat);
    else if (node.type === 'RestElement') pat(node.argument);
    else if (node.type === 'ObjectPattern') node.properties.forEach(p => pat(p.type === 'RestElement' ? p.argument : p.value));
  }
  function walk(node){
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'FunctionDeclaration' && node.id) names.add(node.id.name);
    if (node.type === 'ClassDeclaration' && node.id) names.add(node.id.name);
    if (node.type === 'VariableDeclaration') node.declarations.forEach(d => pat(d.id));
    if (node.type === 'ImportDeclaration') node.specifiers.forEach(s => names.add(s.local.name));
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(c => c && c.type && walk(c));
      else if (child && child.type) walk(child);
    }
  }
  walk(ast);
  return names;
}

function freeReads(ast){
  const reads = [];
  const stack = [new Set()];
  function declare(name){ if (name) stack[stack.length - 1].add(name); }
  function known(name){
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].has(name)) return true;
    return false;
  }
  function pat(node){
    if (!node) return;
    if (node.type === 'Identifier') declare(node.name);
    else if (node.type === 'AssignmentPattern') { pat(node.left); if (node.right) visit(node.right, node); }
    else if (node.type === 'ArrayPattern') node.elements.forEach(pat);
    else if (node.type === 'RestElement') pat(node.argument);
    else if (node.type === 'ObjectPattern') node.properties.forEach(p => {
      if (p.type === 'RestElement') pat(p.argument);
      else pat(p.value);
    });
  }
  function visit(node, parent){
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (node.type === 'FunctionDeclaration' && node.id) declare(node.id.name);
      stack.push(new Set());
      if (node.id && node.type !== 'FunctionDeclaration') declare(node.id.name);
      (node.params || []).forEach(pat);
      if (node.body && node.body.type === 'BlockStatement') node.body.body.forEach(st => visit(st, node.body));
      else if (node.body) visit(node.body, node);
      stack.pop();
      return;
    }
    if (node.type === 'BlockStatement' || node.type === 'StaticBlock' || node.type === 'SwitchStatement' || node.type === 'CatchClause' || node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      stack.push(new Set());
      if (node.type === 'CatchClause' && node.param) pat(node.param);
      if (node.type === 'ForStatement' && node.init && node.init.type === 'VariableDeclaration' && node.init.kind !== 'var') visit(node.init, node);
      if ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && node.left && node.left.type === 'VariableDeclaration' && node.left.kind !== 'var') visit(node.left, node);
      const skip = new Set();
      if (node.type === 'ForStatement' && node.init && node.init.type === 'VariableDeclaration' && node.init.kind !== 'var') skip.add('init');
      if ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && node.left && node.left.type === 'VariableDeclaration' && node.left.kind !== 'var') skip.add('left');
      if (node.type === 'CatchClause') skip.add('param');
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end' || skip.has(key)) continue;
        const child = node[key];
        if (Array.isArray(child)) child.forEach(c => c && c.type && visit(c, node));
        else if (child && child.type) visit(child, node);
      }
      stack.pop();
      return;
    }
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        pat(d.id);
        if (d.init) visit(d.init, d);
      }
      return;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.type === 'ClassDeclaration' && node.id) declare(node.id.name);
      if (node.superClass) visit(node.superClass, node);
      stack.push(new Set());
      if (node.id && node.type === 'ClassExpression') declare(node.id.name);
      if (node.body) visit(node.body, node);
      stack.pop();
      return;
    }
    if (node.type === 'Identifier') {
      if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
      if (parent && parent.type === 'Property' && parent.key === node && !parent.computed && parent.shorthand !== true) return;
      if (parent && parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return;
      if (parent && parent.type === 'PropertyDefinition' && parent.key === node && !parent.computed) return;
      if (parent && parent.type === 'LabeledStatement' && parent.label === node) return;
      if (parent && (parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && parent.label === node) return;
      if (parent && parent.type === 'MetaProperty') return;
      if (parent && parent.type === 'ExportSpecifier' && parent.exported === node && parent.local !== node) return;
      if (!known(node.name)) reads.push({ name: node.name, line: node.loc && node.loc.start.line });
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(c => c && c.type && visit(c, node));
      else if (child && child.type) visit(child, node);
    }
  }
  visit(ast, null);
  return reads;
}

function parse(code, sourceType){
  return acorn.parse(code, { ecmaVersion: 2022, sourceType, locations: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: sourceType === 'module' });
}

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const classic = scriptsOf(html);
const shared = new Set(BROWSER);
for (const file of localScripts(html)) {
  const code = readFileSync(path.join(ROOT, file), 'utf8');
  try { for (const name of declaredNames(parse(code, 'script'))) shared.add(name); }
  catch (err) { console.log('  FAIL parse ' + file + ' ' + err.message); process.exit(1); }
}
for (const code of classic) {
  try { for (const name of declaredNames(parse(code, 'script'))) shared.add(name); }
  catch (err) { console.log('  FAIL parse inline ' + err.message); process.exit(1); }
}

const problems = [];
function report(where, reads){
  const seen = new Set();
  for (const hit of reads) {
    const key = hit.name + '@' + where;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(where + ':' + hit.line + ' ' + hit.name);
  }
}
for (const code of classic) {
  const reads = freeReads(parse(code, 'script')).filter(hit => !shared.has(hit.name));
  report('index.html', reads);
}
for (const file of ['asr.js', 'sw.js']) {
  const code = readFileSync(path.join(ROOT, file), 'utf8');
  const sourceType = file.endsWith('asr.js') ? 'module' : 'script';
  const ast = parse(code, sourceType);
  const own = declaredNames(ast);
  const globals = new Set([...BROWSER, ...own]);
  const reads = freeReads(ast).filter(hit => !globals.has(hit.name));
  report(file, reads);
}

if (problems.length) {
  problems.forEach(p => console.log('  FAIL undeclared ' + p));
  console.log('\n' + problems.length + ' undeclared name(s)');
  process.exit(1);
}
console.log('  ok   no undeclared names in the app scripts');
console.log('\nundef checks passed');
