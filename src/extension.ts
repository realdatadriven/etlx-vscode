// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import AdmZip from 'adm-zip';

let contextRef: vscode.ExtensionContext;
let outputChannel: vscode.OutputChannel;

function log(message: string, level: 'info' | 'error' | 'warn' = 'info'): void {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[ETLX ${timestamp}]`;

    // Log to Output Channel (persistent)
    outputChannel.appendLine(`${prefix} ${message}`);

    // Also show important messages in notifications
    if (level === 'error') {
        vscode.window.showErrorMessage(message);
    } else if (level === 'warn') {
        vscode.window.showWarningMessage(message);
    } else if (level === 'info') {
        // Only show non-spammy info messages
        if (message.includes('Downloading') || message.includes('✅') || message.includes('Failed')) {
            vscode.window.showInformationMessage(message);
        }
    }
}

async function getBinaryPath(): Promise<string> {
    const config = vscode.workspace.getConfiguration('etlx');
    const customPath = config.get<string>('binaryPath');

    if (customPath && fs.existsSync(customPath)) {
        log(`Using custom binary path: ${customPath}`);
        return customPath;
    }

    const binDir = path.join(contextRef.globalStorageUri.fsPath, 'etlx-bin');
    await fs.promises.mkdir(binDir, { recursive: true });

    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    const ext = process.platform === 'win32' ? '.exe' : '';

    const zipName = `etlx-${platform}-${arch}.zip`;
    const finalBinaryPath = path.join(binDir, `etlx${ext}`);
    const zipPath = path.join(binDir, zipName);

    if (fs.existsSync(finalBinaryPath)) {
        log(`Using cached binary: ${finalBinaryPath}`);
        return finalBinaryPath;
    }

    log(`Downloading latest etlx for ${platform}-${arch}...`);

    const downloadUrl = `https://github.com/realdatadriven/etlx/releases/latest/download/${zipName}`;
    log(`Download URL: ${downloadUrl}`);

    await downloadFile(downloadUrl, zipPath);

    try {
        const zip = new AdmZip(zipPath);
        const entries = zip.getEntries();

        if (entries.length === 0) {throw new Error('Downloaded zip is empty');}

        //const binaryEntry = entries.find(entry => !entry.isDirectory);
		const binaryEntry = entries.find((entry: AdmZip.IZipEntry) => !entry.isDirectory);
        if (!binaryEntry) {throw new Error('No binary found in zip');}

        log(`Extracting binary: ${binaryEntry.entryName}`);

        zip.extractEntryTo(binaryEntry, binDir, false, true);

        const extractedPath = path.join(binDir, binaryEntry.entryName);
        if (extractedPath !== finalBinaryPath) {
            if (fs.existsSync(finalBinaryPath)) {fs.unlinkSync(finalBinaryPath);}
            fs.renameSync(extractedPath, finalBinaryPath);
        }

        if (process.platform !== 'win32') {
            fs.chmodSync(finalBinaryPath, '755');
        }

        fs.unlinkSync(zipPath);

        log(`✅ Binary successfully extracted to: ${finalBinaryPath}`);
        return finalBinaryPath;

    } catch (err: any) {
        if (fs.existsSync(zipPath)) {fs.unlinkSync(zipPath);}
        log(`Failed to extract binary: ${err.message}`, 'error');
        throw err;
    }
}

async function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                log(`Following redirect to: ${response.headers.location}`);
                downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(dest);
            response.pipe(file);

            file.on('finish', () => {
                file.close();
                log(`Download completed: ${path.basename(dest)}`);
                resolve();
            });

            file.on('error', (err) => {
                fs.unlinkSync(dest);
                reject(err);
            });
        }).on('error', reject);
    });
}

// Toggle Active Function
async function toggleSectionActive(uri: vscode.Uri, sectionTitle: string, level: number): Promise<boolean> {
    const document = await vscode.workspace.openTextDocument(uri);
    let text = document.getText();

    const aux = '```';
    const headerRegex = new RegExp(`(^#{${level}}\\s+${escapeRegExp(sectionTitle)}[\\s\\S]*?)(${aux}yaml\\s*([\\s\\S]*?)${aux})?`, 'im');

    const match = text.match(headerRegex);
    if (!match) {
        log(`Section "${sectionTitle}" not found`, 'warn');
        return false;
    }

    let yamlBlock = match[3] || '';
    const hasActiveFalse = /active:\s*false/i.test(yamlBlock);
    const hasActiveTrue = /active:\s*true/i.test(yamlBlock);

    let newYaml = yamlBlock;
    if (hasActiveFalse) {
        newYaml = yamlBlock.replace(/active:\s*false/i, 'active: true');
    } else if (!hasActiveTrue) {
        newYaml = 'active: true\n' + yamlBlock;
    } else {
        log(`Section "${sectionTitle}" already active`);
        return true;
    }

    const replacement = match[2]
        ? match[1] + '```yaml\n' + newYaml + '```'
        : match[1] + '\n```yaml\n' + newYaml + '\n```';

    const newText = text.replace(headerRegex, replacement);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), newText);

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
        await document.save();
        log(`✅ Section "${sectionTitle}" activated successfully`);
    }
    return success;
}

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runEtlxCommand(uri: vscode.Uri, sectionTitle?: string) {
    let binaryPath: string;
    try {
        binaryPath = await getBinaryPath();
    } catch (err: any) {
        log(`Failed to get binary: ${err.message}`, 'error');
        return;
    }

    const document = await vscode.workspace.openTextDocument(uri);

    if (sectionTitle) {
        log(`Preparing to run section: ${sectionTitle}`);
        const success = await toggleSectionActive(uri, sectionTitle, 1);
        if (!success) {return;}
    } else {
        log('Running full pipeline');
    }

    const terminalName = sectionTitle ? `ETLX - ${sectionTitle}` : 'ETLX Pipeline';
    const terminal = vscode.window.createTerminal(terminalName);
    terminal.show();

    const cmd = `"${binaryPath}" --config "${uri.fsPath}"`;
    log(`Executing command: ${cmd}`);

    terminal.sendText(cmd);
    log(`🚀 Started ETLX execution in terminal: ${terminalName}`);
}

// CodeLens Provider
class EtlxCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const headerRegex = /^(#{1,2})\s+(.+?)\s*$/gm;

        let match: RegExpExecArray | null;
        while ((match = headerRegex.exec(text)) !== null) {
            const level = match[1].length;
            const title = match[2].trim();
            const line = document.positionAt(match.index).line;
            const range = new vscode.Range(line, 0, line, match[0].length);

            lenses.push(new vscode.CodeLens(range, {
                title: "▶ Run",
                command: "etlx.runSection",
                arguments: [document.uri, title, level]
            }));

            lenses.push(new vscode.CodeLens(range, {
                title: "🔄 Toggle Active",
                command: "etlx.toggleActive",
                arguments: [document.uri, title, level]
            }));
        }
        return lenses;
    }
}

export async function activate(ctx: vscode.ExtensionContext) {
    contextRef = ctx;

    // Create Output Channel for persistent logs
    outputChannel = vscode.window.createOutputChannel("ETLX");
    ctx.subscriptions.push(outputChannel);

    log("ETLX extension activated");

    ctx.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'etlx', scheme: 'file' },
            new EtlxCodeLensProvider()
        )
    );

    ctx.subscriptions.push(
        vscode.commands.registerCommand('etlx.runPipeline', async (uri?: vscode.Uri) => {
            const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
            if (!targetUri) {
                log('No active ETLX document found', 'error');
                return;
            }
            await runEtlxCommand(targetUri);
        })
    );

    ctx.subscriptions.push(
        vscode.commands.registerCommand('etlx.runSection', async (uri: vscode.Uri, title: string, level: number) => {
            await runEtlxCommand(uri, title);
        })
    );

    ctx.subscriptions.push(
        vscode.commands.registerCommand('etlx.toggleActive', async (uri: vscode.Uri, title: string, level: number) => {
            await toggleSectionActive(uri, title, level);
        })
    );

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = "$(play) ETLX";
    statusBar.tooltip = "ETLX Extension Ready - Check 'ETLX' output channel for logs";
    statusBar.command = 'etlx.runPipeline';
    statusBar.show();
    ctx.subscriptions.push(statusBar);

    log("ETLX ready. Use Ctrl+P → ETLX: New ETLX Pipeline to get started.");
}

export function deactivate() {
    if (outputChannel) {outputChannel.dispose();}
}