// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as child_process from 'child_process';

let contextRef: vscode.ExtensionContext;

async function getBinaryPath(): Promise<string> {
    const config = vscode.workspace.getConfiguration('etlx');
    let binaryPath = config.get<string>('binaryPath');

    if (binaryPath && fs.existsSync(binaryPath)) {
        return binaryPath;
    }

    // Auto-downloaded binary location
    const binDir = path.join(contextRef.globalStorageUri.fsPath, 'etlx-bin');
    await fs.promises.mkdir(binDir, { recursive: true });

    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binaryName = `etlx-bin-${platform}-${arch}${ext}`;
    const finalPath = path.join(binDir, `etlx-bin${ext}`);

    if (fs.existsSync(finalPath)) {
        return finalPath;
    }

    vscode.window.showInformationMessage(`📥 Downloading latest etlx-bin for ${platform}...`);

    // TODO: Update this URL once real binaries are released on GitHub
    const downloadUrl = `https://github.com/realdatadriven/etlx/releases/latest/download/${binaryName}`;

    return new Promise((resolve, reject) => {
        https.get(downloadUrl, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(finalPath);
            response.pipe(file);

            file.on('finish', async () => {
                file.close();
                if (process.platform !== 'win32') {
                    fs.chmodSync(finalPath, '755');
                }
                vscode.window.showInformationMessage('✅ etlx-bin downloaded successfully!');
                resolve(finalPath);
            });
        }).on('error', (err) => {
            vscode.window.showErrorMessage(`Failed to download etlx-bin: ${err.message}`);
            reject(err);
        });
    });
}

async function toggleSectionActive(uri: vscode.Uri, sectionTitle: string, level: number): Promise<boolean> {
    const document = await vscode.workspace.openTextDocument(uri);
    let text = document.getText();

    // Find the header and the following YAML block
	const _aux = '```';
    const headerRegex = new RegExp(`(^#{${level}}\\s+${escapeRegExp(sectionTitle)}[\\s\\S]*?)(${_aux}yaml\\s*([\\s\\S]*?)${_aux})?`, 'im');

    const match = text.match(headerRegex);
    if (!match) {
        vscode.window.showWarningMessage(`Section "${sectionTitle}" not found.`);
        return false;
    }

    let yamlBlock = match[3] || '';
    const hasActiveFalse = /active:\s*false/i.test(yamlBlock);
    const hasActiveTrue = /active:\s*true/i.test(yamlBlock);

    let newYaml = yamlBlock;

    if (hasActiveFalse) {
        newYaml = yamlBlock.replace(/active:\s*false/i, 'active: true');
    } else if (!hasActiveTrue) {
        // Insert active: true at the top of the YAML block
        newYaml = 'active: true\n' + yamlBlock;
    } else {
        vscode.window.showInformationMessage(`Section "${sectionTitle}" is already active.`);
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
        vscode.window.showInformationMessage(`✅ "${sectionTitle}" set to active.`);
    }
    return success;
}

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runEtlxCommand(uri: vscode.Uri, sectionTitle?: string) {
    const binaryPath = await getBinaryPath();
    if (!binaryPath) {return;}

    const document = await vscode.workspace.openTextDocument(uri);

    // If a specific section is provided, ensure it's active
    if (sectionTitle) {
        const success = await toggleSectionActive(uri, sectionTitle, 1); // default to level 1; you can improve detection
        if (!success) {return;}
    }

    const terminalName = sectionTitle ? `ETLX - ${sectionTitle}` : 'ETLX Pipeline';
    const terminal = vscode.window.createTerminal(terminalName);
    terminal.show();

    const cmd = `"${binaryPath}" --config "${uri.fsPath}"`;
    terminal.sendText(cmd);

    vscode.window.showInformationMessage(`🚀 Running ETLX${sectionTitle ? `: ${sectionTitle}` : ' Pipeline'}...`);
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

            // Run button
            lenses.push(new vscode.CodeLens(range, {
                title: "▶ Run",
                command: "etlx.runSection",
                arguments: [document.uri, title, level]
            }));

            // Toggle Active button
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

    // Register language (already in package.json, but good to have)
    ctx.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'etlx', scheme: 'file' },
            new EtlxCodeLensProvider()
        )
    );

    // Commands
    ctx.subscriptions.push(
        vscode.commands.registerCommand('etlx.runPipeline', async (uri?: vscode.Uri) => {
            const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
            if (!targetUri) {
                vscode.window.showErrorMessage('No ETLX document open.');
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

    // Optional: Status bar
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = "$(play) ETLX";
    statusBar.tooltip = "ETLX Extension Ready";
    statusBar.command = 'etlx.runPipeline';
    statusBar.show();
    ctx.subscriptions.push(statusBar);

    vscode.window.showInformationMessage('ETLX extension activated. Ready to run pipelines!');
}

export function deactivate() {}