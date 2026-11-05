import ts from 'typescript';
import type { ScriptEntry } from '../core/config.js';
import { SCRIPT_BUDGET_WARN_RATIO, SCRIPT_MAX_BYTES, UNSUPPORTED_ARRAY_METHODS, UNSUPPORTED_GLOBALS } from '../core/runtime-profile.js';

export type Severity = 'error' | 'warning';

export interface Finding {
    severity: Severity;
    rule: string;
    message: string;
    scriptId?: string;
    file?: string;
    line?: number;
    column?: number;
    bundle?: 'unminified';
}

export interface ArtifactCheckOptions {
    publicEnv: readonly string[];
    shippedCode?: string;
}

const warningGlobals = new Set(['Symbol', 'Proxy', 'Reflect', 'WeakMap', 'WeakSet']);
const unsupportedGlobals = new Set<string>(UNSUPPORTED_GLOBALS);
const callbackMethods = new Set<string>(UNSUPPORTED_ARRAY_METHODS.filter(method => !['flat', 'includes', 'fill', 'copyWithin', 'entries', 'keys', 'values'].includes(method)));
const builtinReceivers = new Set(['Object', 'JSON', 'Math', 'String', 'Number', 'Array']);

function memberName(node: ts.Node): string | undefined {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
    return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return node;
}

function isReference(node: ts.Identifier): boolean {
    const parent = node.parent;
    if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isVariableDeclaration(parent)
        || ts.isParameter(parent) || ts.isClassDeclaration(parent)) && parent.name === node) return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
    if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent)
        || ts.isSetAccessorDeclaration(parent)) && parent.name === node) return false;
    return !ts.isLabeledStatement(parent) && !ts.isBreakStatement(parent) && !ts.isContinueStatement(parent);
}

function executionScope(node: ts.Node): ts.Node {
    while (node.parent && !ts.isFunctionLike(node) && !ts.isSourceFile(node)) node = node.parent;
    return node;
}

function hasUnicodeEscape(text: string): boolean {
    for (let index = 0; index < text.length; index++) {
        if (text[index] !== '\\') continue;
        if (text[++index] === 'u') return true;
    }
    return false;
}

export function checkArtifact(code: string, entry: ScriptEntry, options: ArtifactCheckOptions): Finding[] {
    const filename = `${entry.artifactName}.js`;
    const source = ts.createSourceFile(filename, code, ts.ScriptTarget.ES5, true, ts.ScriptKind.JS);
    const host = ts.createCompilerHost({});
    host.getSourceFile = name => name === filename ? source : undefined;
    host.fileExists = name => name === filename;
    host.readFile = name => name === filename ? code : undefined;
    const program = ts.createProgram([filename], { allowJs: true, noLib: true, noResolve: true }, host);
    const checker = program.getTypeChecker();
    const findings: Finding[] = [];
    const helpers = new Set<string>();

    function add(rule: string, severity: Severity, message: string, node?: ts.Node): void {
        const position = source.getLineAndCharacterOfPosition(node?.getStart(source) ?? 0);
        const excerpt = (node?.getText(source) ?? code).trim().replace(/\s+/g, ' ').slice(0, 120) || '[whitespace]';
        findings.push({ rule, severity, message: `${message} Code: ${JSON.stringify(excerpt)}`, scriptId: entry.id, file: `dist/${filename}`, line: position.line + 1, column: position.character + 1 });
    }

    function free(node: ts.Identifier): boolean {
        const symbol = ts.isShorthandPropertyAssignment(node.parent)
            ? checker.getShorthandAssignmentValueSymbol(node.parent)
            : checker.getSymbolAtLocation(node);
        return !symbol?.declarations?.length;
    }

    function envObject(node: ts.Expression): boolean {
        node = unwrap(node);
        if (memberName(node) !== 'env' || !(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return false;
        const root = unwrap(node.expression);
        return ts.isIdentifier(root) && root.text === 'process' && free(root);
    }

    const size = Buffer.byteLength(options.shippedCode ?? code, 'utf8');
    if (size > SCRIPT_MAX_BYTES) {
        add('size-limit', 'error', `Artifact is ${size} bytes; the device limit is ${SCRIPT_MAX_BYTES} bytes.`);
    } else if (size > SCRIPT_MAX_BYTES * SCRIPT_BUDGET_WARN_RATIO) {
        add('size-budget', 'warning', `Artifact is ${size} bytes, above ${SCRIPT_BUDGET_WARN_RATIO * 100}% of the ${SCRIPT_MAX_BYTES}-byte limit.`);
    }

    function visit(node: ts.Node, callbackDepth: number): void {
        let depth = callbackDepth;
        if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
            let argument: ts.Node = node;
            while (ts.isParenthesizedExpression(argument.parent)) argument = argument.parent;
            if (ts.isCallExpression(argument.parent) && argument.parent.arguments.some(value => value === argument)) {
                depth++;
                if (depth > 2) add('callback-nesting', 'warning', `Callback nesting is ${depth} levels deep; keep it at 2 or fewer.`, node);
            }
        }

        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const parent = node.parent;
            const object = unwrap(node.expression);
            if (memberName(node) === 'setPrototypeOf' && ts.isIdentifier(object) && object.text === 'Object' && free(object)) {
                add('class-inheritance', 'warning', 'Object.setPrototypeOf is not supported by the device.', node);
            }
            if (envObject(node.expression)) {
                const name = memberName(node) ?? '[dynamic]';
                const hint = options.publicEnv.includes(name) ? ' Use a direct property access for this value.' : '';
                add('unresolved-env', 'error', `Unresolved process.env.${name}. Only SHELLY_PUBLIC_* values that are set at build time are inlined.${hint}`, node);
            } else if (envObject(node) && !((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node)) {
                add('unresolved-env', 'error', 'Unresolved process.env access. Only SHELLY_PUBLIC_* values that are set at build time are inlined.', node);
            }
        }

        if (ts.isIdentifier(node)) {
            if (isReference(node)) {
                const symbol = ts.isShorthandPropertyAssignment(node.parent)
                    ? checker.getShorthandAssignmentValueSymbol(node.parent)
                    : checker.getSymbolAtLocation(node);
                const declaration = symbol?.declarations?.find(ts.isFunctionDeclaration);
                if (declaration && node.getStart(source) < declaration.getStart(source)
                    && executionScope(node) === executionScope(declaration.parent)) {
                    let reference: ts.Node = node;
                    while (ts.isParenthesizedExpression(reference.parent)) reference = reference.parent;
                    const call = reference.parent;
                    const callee = ts.isCallExpression(call) ? unwrap(call.expression) : undefined;
                    if (ts.isCallExpression(call) && call.arguments[0] === reference
                        && callee && ts.isIdentifier(callee) && /^__extends(?:_\d+)?$/.test(callee.text)) {
                        add('class-inheritance', 'error', "class ... extends ... is not supported on the device because TypeScript's ES5 output relies on function hoisting. Use composition or plain objects instead.", node);
                    } else {
                        add('use-before-declaration', 'error', `Function ${node.text} is referenced before its declaration. Move the declaration before this reference.`, node);
                    }
                }
            }
            if (node.text === 'eval' && isReference(node) && free(node)) {
                add('dynamic-code', 'error', 'eval cannot execute dynamic code on the device.', node);
            }
            if (/^__(?:awaiter|generator)(?:_\d+)?$/.test(node.text) && !helpers.has('async-function')) {
                helpers.add('async-function');
                add('async-function', 'error', 'Async/generator helpers are not supported by the device. Use callbacks instead.', node);
            }
            if (/^__extends(?:_\d+)?$/.test(node.text) && !helpers.has('class-inheritance')) {
                helpers.add('class-inheritance');
                add('class-inheritance', 'warning', 'Class inheritance uses prototype operations that the device may not support.', node);
            }
            if (unsupportedGlobals.has(node.text) && isReference(node) && free(node)) {
                const parent = node.parent;
                const isEnvRoot = node.text === 'process' && (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && envObject(parent);
                if (!isEnvRoot) add('unsupported-global', warningGlobals.has(node.text) ? 'warning' : 'error', `Global ${node.text} is not supported by the device.`, node);
            }
        }

        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            const callee = unwrap(node.expression);
            if (ts.isIdentifier(callee) && free(callee) && callee.text === 'Function') {
                add('dynamic-code', 'error', `${callee.text} cannot execute dynamic code on the device.`, node);
            }
            if (ts.isCallExpression(node)) {
                const name = memberName(callee);
                const callback = node.arguments[0] && unwrap(node.arguments[0]);
                if (name && callbackMethods.has(name) && callback
                    && (ts.isFunctionExpression(callback) || ts.isArrowFunction(callback) || ts.isIdentifier(callback))
                    && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
                    const object = unwrap(callee.expression);
                    const builtin = ts.isIdentifier(object) && builtinReceivers.has(object.text) && free(object);
                    const declaredMethod = checker.getTypeAtLocation(object).getProperty(name)?.declarations?.length;
                    if (!builtin && !declaredMethod) add('unsupported-array-method', 'warning', `Method .${name}() may be an unsupported array method. Use a loop instead.`, node);
                }
            }
        }

        if (ts.isStringLiteralLike(node)) {
            if (hasUnicodeEscape(node.getText(source))) add('unicode-escape', 'error', 'Unicode escapes in string literals are not supported by the device. Use raw UTF-8 characters.', node);
            if (/[^\x00-\x7f]/.test(node.text)) add('non-ascii', 'warning', 'Non-ASCII string characters use UTF-8 bytes on the device; string indexing and length count bytes.', node);
        }
        ts.forEachChild(node, child => visit(child, depth));
    }

    visit(source, 0);
    return findings;
}
