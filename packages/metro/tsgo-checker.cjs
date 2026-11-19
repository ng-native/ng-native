/**
 * Type checking for `compilation: 'ngp'`, through TypeScript 7's language server (`tsgo --lsp
 * --stdio`). Each file goes in as an in-memory document: its source with NGP's type-check block
 * appended, so nothing is written to disk. Ported from `@analogjs/vite-plugin-angular`'s
 * `LspTypeChecker`, under its license:
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2022 Brandon Roberts
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parse } = require('@babel/parser');

const TCB_TEMPLATE_SOURCES_PREFIX = 'ngp-tcb-template-sources:';
const IGNORED_TCB_CODES = new Set([6133, 6199, 2695, 7006]);
const TCB_IMPORT_ALIAS = /^(?:_tcb_)?_?i\d+$/;
const TCB_LOCAL_NAME = /^(?:_tcb|_ctor|_pipe)\d+$/;
const SPAN_COMMENT = /^(\d+),(\d+)$/;
const LSP_ARGS = ['--lsp', '--stdio'];
let warnedTsconfig = false;

const PREFIX = '__ngn';

/** @param {string} code @param {boolean} [jsx] */
function parseTs(code, jsx = false) {
  return parse(code, {
    sourceType: 'module',
    plugins: jsx ? ['typescript', 'decorators', 'jsx'] : ['typescript', 'decorators'],
    errorRecovery: true,
  });
}

/** @param {any} node @param {(node: any) => void} visit */
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key in node) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (value && typeof value === 'object') walk(value, visit);
  }
}

/** @param {any} statement */
function declaredName(statement) {
  if (statement.type === 'VariableDeclaration') return statement.declarations[0]?.id?.name;
  if (statement.type === 'FunctionDeclaration' || statement.type === 'TSDeclareFunction') {
    return statement.id?.name;
  }
  return undefined;
}

/** @param {any} statement */
function isTcbImport(statement) {
  const namespace = statement.type === 'ImportDeclaration' && statement.specifiers[0];
  return (
    namespace?.type === 'ImportNamespaceSpecifier' && TCB_IMPORT_ALIAS.test(namespace.local.name)
  );
}

/** @param {any} ast @returns {Record<string, any>} */
function templateSourcesOf(ast) {
  const footer = (ast.comments ?? []).find((/** @type {any} */ comment) =>
    comment.value.startsWith(TCB_TEMPLATE_SOURCES_PREFIX),
  );
  return footer ? JSON.parse(footer.value.slice(TCB_TEMPLATE_SOURCES_PREFIX.length)) : {};
}

/** @param {string} tcb @param {boolean} [jsx] */
function splitTcb(tcb, jsx = false) {
  if (!tcb.includes('/*tcb')) return null;
  let ast;
  try {
    ast = parseTs(tcb, jsx);
  } catch {
    return null;
  }
  if (ast.errors?.length) return null;
  /** @type {{ imports: any[], blocks: any[], templateSources: Record<string, any> }} */
  const parts = { imports: [], blocks: [], templateSources: {} };
  parts.templateSources = templateSourcesOf(ast);
  for (const statement of ast.program.body) {
    if (TCB_LOCAL_NAME.test(declaredName(statement) ?? '')) parts.blocks.push(statement);
    else if (isTcbImport(statement)) parts.imports.push(statement);
  }
  return parts.blocks.length ? parts : null;
}

/** @param {string} specifier @param {string} directory */
function withExtension(specifier, directory) {
  if (!/^\.\.?\//.test(specifier) || path.extname(specifier)) return null;
  const extension = ['.ts', '.tsx', '.mts'].find((candidate) =>
    existsSync(path.resolve(directory, specifier + candidate)),
  );
  if (!extension) return null;
  return specifier + { '.ts': '.js', '.tsx': '.jsx', '.mts': '.mjs' }[extension];
}

/**
 * @param {string} tcb
 * @param {any} node
 * @param {Set<string>} generated
 * @param {string} directory
 */
function relocated(tcb, node, generated, directory) {
  /** @type {[number, number, string][]} */
  const edits = [];
  walk(node, (child) => {
    if (child.type === 'Identifier' && generated.has(child.name)) {
      edits.push([child.start, child.end, PREFIX + child.name]);
    }
  });
  if (node.type === 'ImportDeclaration') {
    const specifier = withExtension(node.source.value, directory);
    if (specifier) edits.push([node.source.start, node.source.end, JSON.stringify(specifier)]);
  }
  let text = tcb.slice(node.start, node.end);
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start - node.start) + replacement + text.slice(end - node.start);
  }
  return text;
}

/**
 * @param {string} filePath
 * @param {string} source
 * @param {string | undefined} tcb
 */
function documentOf(filePath, source, tcb) {
  const lines = source.split('\n');
  const sourceLineCount = lines.length;
  if (!tcb) return { text: source, sourceLineCount, lines, range: null };
  const parts = splitTcb(tcb, filePath.endsWith('.tsx'));
  if (!parts && tcb.includes(source)) {
    const whole = tcb.split('\n');
    const from = tcb.startsWith(source) ? sourceLineCount : 0;
    return {
      text: tcb,
      sourceLineCount: from,
      lines: whole,
      range: { startLine: from, endLine: whole.length, filePath, source, templateSources: {} },
    };
  }
  let suffix = tcb;
  if (parts) {
    const generated = new Set(
      [
        ...parts.blocks.map(declaredName),
        ...parts.imports.map((node) => node.specifiers[0].local.name),
      ].filter(Boolean),
    );
    const directory = path.dirname(filePath);
    suffix = [...parts.imports, ...parts.blocks]
      .map((node) => relocated(tcb, node, generated, directory))
      .join('\n');
  }
  lines.push(...suffix.split('\n'));
  return {
    text: lines.join('\n'),
    sourceLineCount,
    lines,
    range: {
      startLine: sourceLineCount,
      endLine: lines.length,
      filePath,
      source,
      templateSources: parts?.templateSources ?? {},
    },
  };
}

/** @param {string} text @param {number} offset */
function lineAndCharacter(text, offset) {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, character: before[before.length - 1].length + 1 };
}

/**
 * @param {string} text
 * @param {number} at
 * @param {Map<number, any>} commentsByStart
 */
function trailingSpan(text, at, commentsByStart) {
  for (;;) {
    while (at < text.length && /\s/.test(text[at])) at++;
    const comment = commentsByStart.get(at);
    if (!comment) return null;
    const span = SPAN_COMMENT.exec(comment.value);
    if (span) return { start: Number(span[1]), end: Number(span[2]) };
    at = comment.end;
  }
}

/**
 * @param {NonNullable<ReturnType<typeof documentOf>['range']>} range
 * @param {string[]} lines
 * @param {{ line: number, character: number }} position
 */
function templateLocation(range, lines, position) {
  const chunk = lines.slice(range.startLine, range.endLine).join('\n');
  let offset = position.character;
  for (let i = range.startLine; i < position.line; i++) offset += lines[i].length + 1;
  const found = tcbAt(chunk, offset);
  if (!found) return null;
  const templateSource = range.templateSources[found.id];
  const file = templateSource?.templateFile ?? range.filePath;
  let content = range.source;
  if (templateSource?.templateFile) {
    try {
      content = readFileSync(templateSource.templateFile, 'utf8');
    } catch {
      return null;
    }
  }
  const start = templateSource?.templateExpression?.start ?? found.span.start;
  return { file, ...lineAndCharacter(content, start) };
}

/**
 * @param {string} chunk
 * @param {number} offset
 */
function tcbAt(chunk, offset) {
  let ast;
  try {
    ast = parseTs(chunk);
  } catch {
    return null;
  }
  /** @type {Map<number, any>} */
  const commentsByStart = new Map(
    (ast.comments ?? []).map((comment) => [/** @type {number} */ (comment.start), comment]),
  );
  /** @type {any[]} */
  const ancestors = [];
  walk(ast.program.body, (node) => {
    if (node.start <= offset && offset < node.end) ancestors.push(node);
  });
  const tcbFunction = ancestors.find(
    (node) => node.type === 'FunctionDeclaration' && /_tcb\d+$/.test(node.id?.name ?? ''),
  );
  let span = null;
  for (let i = ancestors.length - 1; i >= 0 && !span; i--) {
    span = trailingSpan(chunk, ancestors[i].end, commentsByStart);
  }
  if (!tcbFunction || !span) return null;
  const id = /** @type {RegExpExecArray} */ (/(tcb\d+)$/.exec(tcbFunction.id.name))[1];
  return { id, span };
}

/** @param {string} tsconfig */
function resolveTsgo(tsconfig) {
  const fromEnvironment = process.env['TSNATIVE_BINARY_PATH'];
  if (fromEnvironment) return fromEnvironment;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates = [
    {
      parent: 'typescript/package.json',
      platform: `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
      bin: `tsc${ext}`,
    },
    {
      parent: '@typescript/native-preview/package.json',
      platform: `@typescript/native-preview-${process.platform}-${process.arch}/package.json`,
      bin: `tsgo${ext}`,
    },
  ];
  for (const base of [path.dirname(tsconfig), __dirname]) {
    for (const candidate of candidates) {
      try {
        const parent = require.resolve(candidate.parent, { paths: [base] });
        const platform = require.resolve(candidate.platform, { paths: [path.dirname(parent)] });
        return path.resolve(path.dirname(platform), 'lib', candidate.bin);
      } catch {
        // The next candidate.
      }
    }
  }
  throw new Error(
    "[angular-native] compilation: 'ngp' type-checks with TypeScript 7: install typescript@^7, " +
      '@typescript/native-preview, or set TSNATIVE_BINARY_PATH. disableTypeChecking: true turns ' +
      'the check off.',
  );
}

class TsgoChecker {
  /** @param {string} tsconfig */
  constructor(tsconfig) {
    const cwd = path.dirname(tsconfig);
    if (path.basename(tsconfig) !== 'tsconfig.json' && !warnedTsconfig) {
      warnedTsconfig = true;
      console.warn(
        `[angular-native] compilation: 'ngp' analyzes ${path.basename(tsconfig)}, but TypeScript ` +
          "7's language server checks each file against the nearest tsconfig.json. Keep the two " +
          'in step, or set disableTypeChecking: true.',
      );
    }
    this.seq = 1;
    /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    /** @type {Map<string, number>} */
    this.versions = new Map();
    this.buffer = Buffer.alloc(0);
    /** @type {Error | undefined} */
    this.exitError = undefined;
    this.proc = spawn(resolveTsgo(tsconfig), LSP_ARGS, { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc.stdout?.on('data', (chunk) => this.onData(chunk));
    this.proc.on('error', (error) => this.fail(error));
    this.proc.stdin?.on('error', (error) => this.fail(error));
    this.proc.on('exit', (code) => this.fail(new Error(`type checker exited with code ${code}`)));
    this.proc.unref();
    const rootUri = pathToFileURL(cwd).href;
    this.ready = this.request('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: { textDocument: { diagnostic: {} } },
      workspaceFolders: [{ uri: rootUri, name: 'root' }],
    }).then(() => this.notify('initialized', {}));
    this.ready.catch(() => {});
  }

  /** @param {Error} error */
  fail(error) {
    this.exitError ??= error;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(this.exitError);
    }
    this.pending.clear();
  }

  /** @param {Buffer} chunk */
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (let message = this.nextMessage(); message; message = this.nextMessage()) {
      this.dispatch(message);
    }
  }

  nextMessage() {
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return null;
    const length = /Content-Length: (\d+)/i.exec(
      this.buffer.subarray(0, headerEnd).toString('utf8'),
    );
    if (!length) return this.broken('a message with no Content-Length');
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(length[1]);
    if (this.buffer.length < bodyEnd) return null;
    let message;
    try {
      message = JSON.parse(this.buffer.subarray(bodyStart, bodyEnd).toString('utf8'));
    } catch {
      return this.broken('a message that is not JSON');
    }
    if (typeof message !== 'object' || message === null) {
      return this.broken('a message that is not a JSON object');
    }
    this.buffer = this.buffer.subarray(bodyEnd);
    return message;
  }

  /** @param {any} message */
  dispatch(message) {
    if (message.id !== undefined && message.method !== undefined) {
      this.send({ jsonrpc: '2.0', id: message.id, result: null });
      return;
    }
    const entry = message.id === undefined ? undefined : this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  }

  /** @param {object} payload */
  send(payload) {
    const json = JSON.stringify(payload);
    this.proc.stdin?.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
  }

  /** @param {string} method @param {object} params */
  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  /** @param {string} method @param {object} params @returns {Promise<any>} */
  request(method, params) {
    if (this.exitError) return Promise.reject(this.exitError);
    const id = this.seq++;
    const asked = Number(process.env['ANGULAR_NATIVE_TSGO_TIMEOUT_MS']);
    const timeout = Number.isInteger(asked) && asked >= 1 && asked <= 2 ** 31 - 1 ? asked : 300_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`type checker did not answer ${method} within ${timeout / 1000}s`);
        reject(error);
        this.fail(error);
        this.proc.kill();
      }, timeout);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** @param {string} what @returns {null} */
  broken(what) {
    this.buffer = Buffer.alloc(0);
    this.fail(new Error(`type checker sent ${what}`));
    this.proc.kill();
    return null;
  }

  /** @param {string} filePath @param {string} text */
  updateDocument(filePath, text) {
    const uri = pathToFileURL(path.resolve(filePath)).href;
    if (!this.versions.has(uri)) {
      this.versions.set(uri, 1);
      this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'typescript', version: 1, text },
      });
      return;
    }
    const version = /** @type {number} */ (this.versions.get(uri)) + 1;
    this.versions.set(uri, version);
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  /** @param {{ filePath: string, updateType: 'Created' | 'Deleted' | 'Changed' }[]} changes */
  filesChanged(changes) {
    const types = { Created: 1, Changed: 2, Deleted: 3 };
    const closed = [];
    const watched = [];
    for (const { filePath, updateType } of changes) {
      const uri = pathToFileURL(path.resolve(filePath)).href;
      if (this.versions.delete(uri)) closed.push(uri);
      watched.push({ uri, type: types[updateType] });
    }
    this.ready.then(
      () => {
        for (const uri of closed) this.notify('textDocument/didClose', { textDocument: { uri } });
        this.notify('workspace/didChangeWatchedFiles', { changes: watched });
      },
      () => {},
    );
  }

  /**
   * @param {string} filePath
   * @param {string} source
   * @param {string} [tcb]
   * @returns {Promise<string[]>}
   */
  async check(filePath, source, tcb) {
    await this.ready;
    const document = documentOf(filePath, source, tcb);
    this.updateDocument(filePath, document.text);
    const diagnostics = await this.request('textDocument/diagnostic', {
      textDocument: { uri: pathToFileURL(path.resolve(filePath)).href },
    });
    /** @type {string[]} */
    const errors = [];
    for (const item of diagnostics?.items ?? []) {
      if (item.severity !== 1) continue;
      const line = item.range.start.line;
      if (line < document.sourceLineCount) {
        errors.push(
          `${filePath}:${line + 1}:${item.range.start.character + 1} - error TS${item.code}: ` +
            item.message,
        );
        continue;
      }
      if (IGNORED_TCB_CODES.has(Number(item.code))) continue;
      if (document.lines[line]?.includes('/*D:ignore*/')) continue;
      const location =
        document.range && templateLocation(document.range, document.lines, item.range.start);
      errors.push(
        location
          ? `${location.file}:${location.line}:${location.character} - error TS${item.code}: ` +
              item.message
          : `${filePath} (template): error TS${item.code}: ${item.message}`,
      );
    }
    return errors;
  }

  close() {
    this.proc.kill();
  }
}

module.exports = { TsgoChecker, resolveTsgo, documentOf, splitTcb };
