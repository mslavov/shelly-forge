import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (path) => path,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => '\n',
};

function loadProject(relativePath: string): ts.ParsedCommandLine {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const config = ts.readConfigFile(path, ts.sys.readFile);
  if (config.error) throw new Error(ts.formatDiagnosticsWithColorAndContext([config.error], formatHost));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(path));
  expect(parsed.errors, ts.formatDiagnosticsWithColorAndContext(parsed.errors, formatHost)).toEqual([]);
  return parsed;
}

function diagnosticsFor(project: ts.ParsedCommandLine, host?: ts.CompilerHost): readonly ts.Diagnostic[] {
  return ts.getPreEmitDiagnostics(ts.createProgram({
    rootNames: project.fileNames,
    options: { ...project.options, skipLibCheck: false },
    host,
  }));
}

describe('device type declarations', () => {
  it.each(['./fixtures/tsconfig.json', './node/tsconfig.json'])('compiles %s without diagnostics', (path) => {
    const diagnostics = diagnosticsFor(loadProject(path));
    expect(diagnostics, ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost)).toEqual([]);
  });

  it('isolates two device scripts with the same top-level function name', () => {
    const project = loadProject('./fixtures/tsconfig.json');
    expect(project.options.moduleDetection).toBe(ts.ModuleDetectionKind.Force);
    expect(project.fileNames).toEqual(expect.arrayContaining([
      fileURLToPath(new URL('./fixtures/script-a.ts', import.meta.url)),
      fileURLToPath(new URL('./fixtures/script-b.ts', import.meta.url)),
    ]));
    const diagnostics = diagnosticsFor(project);
    expect(diagnostics, ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost)).toEqual([]);
  });

  it('rejects async functions without a Promise type', () => {
    const project = loadProject('./fixtures/tsconfig.json');
    project.fileNames.push(fileURLToPath(new URL('./fixtures/invalid/async.ts', import.meta.url)));
    const diagnostics = diagnosticsFor(project);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((diagnostic) => diagnostic.code === 2318
      && ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') === "Cannot find global type 'Promise'.")).toBe(true);
  });

  it('rejects every expression marked with @ts-expect-error', () => {
    const project = loadProject('./fixtures/tsconfig.json');
    const host = ts.createCompilerHost(project.options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    const expected: { path: string; line: number }[] = [];
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
      const source = originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
      if (!source || source.isDeclarationFile || !source.text.includes('@ts-expect-error')) return source;
      source.text.split('\n').forEach((line, index) => {
        if (line.includes('@ts-expect-error')) expected.push({ path, line: index + 1 });
      });
      return ts.createSourceFile(path, source.text.replaceAll('@ts-expect-error', 'expected type error'), languageVersion, true);
    };
    const diagnostics = diagnosticsFor(project, host);
    expect(expected.length).toBeGreaterThan(50);
    for (const { path, line } of expected) {
      expect(diagnostics.some((diagnostic) => diagnostic.file?.fileName === path
        && diagnostic.start !== undefined
        && diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line === line),
      `Expected a diagnostic at ${path}:${line + 1}`).toBe(true);
    }
  });
});
