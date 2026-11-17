import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';
import { PACKAGE_ROOT } from '../../src/core/paths.js';

const docs = path.join(PACKAGE_ROOT, 'docs');
const installCommand = 'npx skills add mslavov/shelly-forge --skill shelly-forge shelly-scripting';
const copyScript = await readFile(path.join(docs, 'assets/site.js'), 'utf8');

test('site assets and links resolve under a project path', async () => {
    for (const name of (await readdir(docs)).filter(name => name.endsWith('.html'))) {
        const file = path.join(docs, name);
        const html = await readFile(file, 'utf8');
        for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
            if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
            expect(target.startsWith('/'), `${name}: ${target}`).toBe(false);
            const [relative, anchor] = target.split('#');
            const resolved = relative ? path.resolve(docs, relative) : file;
            expect(path.relative(docs, resolved).startsWith('..'), `${name}: ${target}`).toBe(false);
            expect((await stat(resolved)).isFile(), `${name}: ${target}`).toBe(true);
            if (anchor) {
                const destination = await readFile(resolved, 'utf8');
                const ids = Array.from(destination.matchAll(/\bid="([^"]+)"/g), match => match[1]);
                expect(ids, `${name}: ${target}`).toContain(anchor);
            }
        }
    }
});

test('skills-first documentation uses the same install command', async () => {
    for (const name of ['README.md', 'docs/index.html', 'docs/design.html', 'skills/shelly-forge/reference/cli.md']) {
        expect(await readFile(path.join(PACKAGE_ROOT, name), 'utf8'), name).toContain(installCommand);
    }
});

test('each copy button has a source and its own accessible status', async () => {
    const html = await readFile(path.join(docs, 'index.html'), 'utf8');
    const buttons = Array.from(html.matchAll(/<button\b[^>]*data-copy="([^"]+)"[^>]*aria-describedby="([^"]+)"[^>]*>/g));
    expect(buttons).toHaveLength(2);
    expect(new Set(buttons.map(match => match[2])).size).toBe(2);
    for (const [, source, status] of buttons) {
        expect(html).toContain(`id="${source}"`);
        expect(html).toContain(`id="${status}" role="status"`);
    }
});

function copyFixture(writeText?: (text: string) => Promise<void>, hasSelection = true) {
    const elements: Record<string, { textContent: string }> = {
        command: { textContent: ` ${installCommand}\n` },
        prompt: { textContent: 'Ask before changing a real device.' },
        commandStatus: { textContent: '' },
        promptStatus: { textContent: '' },
    };
    const listeners: Array<() => Promise<void>> = [];
    const buttons = ['command', 'prompt'].map(target => ({
        dataset: { copy: target },
        hidden: true,
        getAttribute: () => `${target}Status`,
        addEventListener: (_event: string, listener: () => Promise<void>) => listeners.push(listener),
    }));
    const range = { selectNodeContents: vi.fn() };
    const selection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
    runInNewContext(copyScript, {
        document: {
            querySelectorAll: () => buttons,
            getElementById: (id: string) => elements[id],
            createRange: () => range,
        },
        navigator: writeText ? { clipboard: { writeText } } : {},
        window: { getSelection: () => hasSelection ? selection : null },
    });
    return { elements, listeners, buttons, range, selection };
}

test('copy buttons write exact text and report success independently', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const fixture = copyFixture(writeText);
    expect(fixture.buttons.every(button => !button.hidden)).toBe(true);
    await fixture.listeners[0]();
    expect(writeText).toHaveBeenLastCalledWith(installCommand);
    expect(fixture.elements.commandStatus.textContent).toBe('Copied to clipboard.');
    expect(fixture.elements.promptStatus.textContent).toBe('');
    await fixture.listeners[1]();
    expect(writeText).toHaveBeenLastCalledWith(fixture.elements.prompt.textContent);
    expect(fixture.elements.promptStatus.textContent).toBe('Copied to clipboard.');
});

test.each(['missing', 'denied'])('copy selects text for manual recovery when clipboard access is %s', async mode => {
    const writeText = mode === 'denied' ? async () => { throw new Error('Permission denied'); } : undefined;
    const fixture = copyFixture(writeText);
    await fixture.listeners[0]();
    expect(fixture.range.selectNodeContents).toHaveBeenCalledWith(fixture.elements.command);
    expect(fixture.selection.addRange).toHaveBeenCalledWith(fixture.range);
    expect(fixture.elements.commandStatus.textContent).toBe('Could not copy. The text is selected. Copy it manually.');
});

test('copy failure does not claim to select text when selection is unavailable', async () => {
    const fixture = copyFixture(undefined, false);
    await fixture.listeners[0]();
    expect(fixture.elements.commandStatus.textContent).toBe('Could not copy. Select the text and copy it manually.');
});
