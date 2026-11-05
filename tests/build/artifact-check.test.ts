import { expect, test } from 'vitest';
import { checkArtifact } from '../../src/build/artifact-check.js';
import { SCRIPT_BUDGET_WARN_RATIO, SCRIPT_MAX_BYTES, UNSUPPORTED_ARRAY_METHODS, UNSUPPORTED_GLOBALS } from '../../src/core/runtime-profile.js';
import { entry } from './helpers.js';

function check(code: string) {
    return checkArtifact(code, entry(), { publicEnv: [] });
}

test('clean ES5 output has no findings', () => {
    expect(check('(function () { var values = [1, 2]; for (var i = 0; i < values.length; i++) print(values[i]); })();')).toEqual([]);
});

test('size rules use UTF-8 bytes and exact limits', () => {
    const budget = Math.floor(SCRIPT_MAX_BYTES * SCRIPT_BUDGET_WARN_RATIO);
    expect(check(' '.repeat(budget))).toEqual([]);
    expect(check(' '.repeat(budget + 1))).toEqual([expect.objectContaining({ rule: 'size-budget', severity: 'warning' })]);
    expect(check(' '.repeat(SCRIPT_MAX_BYTES))).toEqual([expect.objectContaining({ rule: 'size-budget' })]);
    expect(check(' '.repeat(SCRIPT_MAX_BYTES + 1))).toEqual([expect.objectContaining({ rule: 'size-limit', severity: 'error' })]);
    expect(check(`"${'é'.repeat(SCRIPT_MAX_BYTES / 2)}";`)).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'size-limit' })]));
});

test.each(UNSUPPORTED_GLOBALS)('detects free global %s with the runtime severity', name => {
    const findings = check(`\n${name};`);
    expect(findings).toEqual([expect.objectContaining({
        rule: 'unsupported-global', severity: ['Symbol', 'Proxy', 'Reflect', 'WeakMap', 'WeakSet'].includes(name) ? 'warning' : 'error',
        file: 'dist/climate-publish.js', scriptId: 'climate/publish', line: 2, column: 1,
    })]);
    expect(findings[0].message).toContain(name);
});

test.each(UNSUPPORTED_GLOBALS)('does not flag locally declared %s', name => {
    expect(check(`(function (${name}) { return ${name}; })(1);`)).toEqual([]);
    expect(check(`var ${name} = 1; print(${name});`)).toEqual([]);
});

test('respects lexical scopes, destructuring and catch bindings', () => {
    expect(check('{ let fetch = 1; print(fetch); } fetch();')).toEqual([expect.objectContaining({ rule: 'unsupported-global' })]);
    expect(check('var {fetch: fetch} = device; print(fetch); try {} catch (Promise) { print(Promise); }')).toEqual([]);
    expect(check('var object = { fetch: 1, Promise: function() {} }; object.fetch; object.Promise();')).toEqual([]);
    expect(check('var object = { fetch };')).toEqual([expect.objectContaining({ rule: 'unsupported-global' })]);
    expect(check('fetch: for (;;) { break fetch; }')).toEqual([]);
});

test.each([
    'function x() { fetch(); function fetch() {} }',
    'Timer.set(1, true, tick); function tick() {}',
    '(function () { Timer.set(1, true, tick); function tick() {} })();',
    'if (enabled) { tick(); } function tick() {}',
    'var callbacks = { tick }; function tick() {}',
])('rejects a reference evaluated before its function declaration: %s', code => {
    expect(check(code)).toEqual([expect.objectContaining({ rule: 'use-before-declaration', severity: 'error' })]);
});

test.each([
    'function tick() {} Timer.set(1, true, tick);',
    'function start() { tick(); } function tick() {}',
    'Timer.set(1, true, function () { tick(); }); function tick() {}',
    'function tick() { tick(); }',
    'function start() { var tick = 1; print(tick); } function tick() {}',
    'function start(tick) { tick(); } function tick() {}',
    'var object = { tick: 1 }; print(object.tick); function tick() {}',
])('allows declared functions and deferred or shadowed references: %s', code => {
    expect(check(code)).toEqual([]);
});

test('reports hoisted derived-class constructors as unsupported inheritance', () => {
    const findings = check('(function (_super) { __extends(B, _super); function B() {} return B; })(A);');
    expect(findings.filter(finding => finding.severity === 'error')).toEqual([expect.objectContaining({
        rule: 'class-inheritance',
        message: expect.stringContaining("class ... extends ... is not supported on the device because TypeScript's ES5 output relies on function hoisting. Use composition or plain objects instead."),
    })]);
    expect(findings.some(finding => finding.rule === 'use-before-declaration')).toBe(false);
});

test.each([
    ['process.env.SHELLY_PUBLIC_MISSING', 'SHELLY_PUBLIC_MISSING'],
    ['process.env.PRIVATE_KEY', 'PRIVATE_KEY'],
    ['process["env"]["SHELLY_PUBLIC_MISSING"]', 'SHELLY_PUBLIC_MISSING'],
    ['process.env[key]', '[dynamic]'],
    ['process.env', 'process.env'],
])('detects unresolved env access %s', (expression, variable) => {
    const findings = check(`print(${expression});`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'unresolved-env', severity: 'error' });
    expect(findings[0].message).toContain(variable);
    expect(findings[0].message).toContain('Only SHELLY_PUBLIC_* values that are set at build time are inlined');
});

test('does not flag a local process object or literal text as environment access', () => {
    expect(check('function f(process) { print(process.env.LOCAL); }')).toEqual([]);
    expect(check('print("process.env.SHELLY_PUBLIC_MISSING");')).toEqual([]);
});

test.each(['__awaiter', '__generator'])('detects %s helpers and ignores helper text', helper => {
    expect(check(`var ${helper} = function () {}; ${helper}();`).filter(finding => finding.rule === 'async-function')).toHaveLength(1);
    expect(check(`print("${helper}");`)).toEqual([]);
});

test.each(['eval("print(1)")', '(eval)("print(1)")', '(0, eval)("print(1)")', 'var run = eval;', 'new Function("return 1")', 'Function("return 1")'])('rejects dynamic code %s', code => {
    expect(check(code)).toEqual([expect.objectContaining({ rule: 'dynamic-code', severity: 'error' })]);
});

test('does not flag local eval or Function implementations', () => {
    expect(check('function f(eval, Function) { eval(); new Function(); }')).toEqual([]);
});

test.each(UNSUPPORTED_ARRAY_METHODS)('warns for the heuristic .%s() call', method => {
    const expected = ['flat', 'includes', 'fill', 'copyWithin', 'entries', 'keys', 'values'].includes(method)
        ? [] : [expect.objectContaining({ rule: 'unsupported-array-method', severity: 'warning' })];
    expect(check(`value.${method}(callback);`)).toEqual(expected);
    expect(check(`value["${method}"](callback);`)).toEqual(expected);
    expect(check(`var name = "${method}"; print(value.${method});`)).toEqual([]);
});

test('warns only for likely callback-taking array calls', () => {
    expect(check('[1, 2].map(function (value) { return value; }); arr.forEach(cb);'))
        .toEqual([expect.objectContaining({ rule: 'unsupported-array-method' }), expect.objectContaining({ rule: 'unsupported-array-method' })]);
    expect(check('value.filter(1); value.map(); value.filter("text");')).toEqual([]);
    expect(check('Object.keys(value); JSON.stringify(value);')).toEqual([]);
    expect(check('var object = { filter: function (callback) { callback(); }, keys: function () { return []; } }; object.filter(cb); object["filter"](cb); object.keys();')).toEqual([]);
    for (const name of ['Object', 'JSON', 'Math', 'String', 'Number', 'Array']) {
        expect(check(`${name}.filter(cb);`)).toEqual([]);
    }
    expect(check('function run(Object) { Object.filter(cb); }')).toEqual([expect.objectContaining({ rule: 'unsupported-array-method' })]);
});

test('warns on inheritance helpers and Object.setPrototypeOf', () => {
    expect(check('var __extends = function() {}; __extends(A, B);')).toEqual([expect.objectContaining({ rule: 'class-inheritance', severity: 'warning' })]);
    expect(check('Object.setPrototypeOf(A, B);')).toEqual([expect.objectContaining({ rule: 'class-inheritance', severity: 'warning' })]);
    expect(check('var set = Object.setPrototypeOf;')).toEqual([expect.objectContaining({ rule: 'class-inheritance' })]);
    expect(check('function f(Object) { Object.setPrototypeOf(A, B); }')).toEqual([]);
    expect(check('print("__extends");')).toEqual([]);
});

test('counts nested callbacks but not the top-level IIFE or ordinary functions', () => {
    expect(check('(function() { first(function() { second(function() {}); }); })();')).toEqual([]);
    expect(check('(function() { first(function() { second(function() { third(function() {}); }); }); })();'))
        .toEqual([expect.objectContaining({ rule: 'callback-nesting', severity: 'warning' })]);
    expect(check('function a() { function b() { function c() {} } }')).toEqual([]);
});

test('warns on decoded non-ASCII strings, not identifiers or comments', () => {
    expect(check('print("café");')).toEqual([expect.objectContaining({ rule: 'non-ascii', severity: 'warning' })]);
    expect(check('print("caf\\u00e9");')).toEqual([expect.objectContaining({ rule: 'unicode-escape', severity: 'error' }), expect.objectContaining({ rule: 'non-ascii' })]);
    expect(check('var café = 1; print(café); /* café */')).toEqual([]);
});

test('rejects Unicode escape syntax but not escaped backslashes or comments', () => {
    expect(check('print("\\u0061");')).toEqual([expect.objectContaining({ rule: 'unicode-escape', severity: 'error' })]);
    expect(check('print("\\u{61}");')).toEqual([expect.objectContaining({ rule: 'unicode-escape', severity: 'error' })]);
    expect(check('print("\\\\u0061"); /* \\u0061 */')).toEqual([]);
});

test('uses shipped bytes for size checks and unminified locations and excerpts for AST checks', () => {
    const code = '\n\nfetch("url");';
    const findings = checkArtifact(code, entry(), { publicEnv: [], shippedCode: ' '.repeat(SCRIPT_MAX_BYTES + 1) });
    expect(findings).toEqual([
        expect.objectContaining({ rule: 'size-limit', message: expect.stringContaining('fetch(') }),
        expect.objectContaining({ rule: 'unsupported-global', line: 3, column: 1, message: expect.stringContaining('Code: "fetch"') }),
    ]);
});
