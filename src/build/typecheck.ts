import path from 'node:path';
import ts from 'typescript';
import type { Finding } from './artifact-check.js';

export function typecheckProject(projectDir: string): Finding[] {
    const configPath = path.resolve(projectDir, 'tsconfig.json');
    if (!ts.sys.fileExists(configPath)) {
        return [{ severity: 'warning', rule: 'missing-tsconfig', message: 'tsconfig.json was not found; TypeScript checks were skipped.', file: 'tsconfig.json', line: 1, column: 1 }];
    }

    function finding(diagnostic: ts.Diagnostic): Finding {
        const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        return {
            severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
            rule: 'typescript',
            message: `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
            ...(diagnostic.file ? { file: path.relative(projectDir, diagnostic.file.fileName).split(path.sep).join('/') } : {}),
            line: (position?.line ?? 0) + 1,
            column: (position?.character ?? 0) + 1,
        };
    }

    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) return [finding(config.error)];
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.resolve(projectDir), undefined, configPath);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
    return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(finding);
}
