# ETLX - VS Code Extension

**Full support for ETLX Markdown pipelines** — syntax highlighting, interactive execution, and seamless integration with `etlx-bin`.

![ETLX Logo](https://realdatadriven.github.io/etlxdocs/assets/etlx-logo.png)

## Features

- **Language Support** for `.xmd`, `.etlxmd`, and `.eltx` files
- **Full Markdown + ETLX syntax highlighting**
  - Normal Markdown works perfectly
  - Special highlighting for `active:`, `runs_as:`, `name:`, `description:`, `depends_on:`, etc.
- **Interactive CodeLenses**
  - `▶ Run` button on every `# Section` and `## Subsection`
  - `🔄 Toggle Active` button on every section
- **Global Run Button** in the editor title bar (`ETLX: Run Entire Pipeline`)
- **Automatic binary management**
  - Downloads the latest `etlx-bin` on first use
  - Stores it safely in global storage
  - Fully configurable via settings (`etlx.binaryPath`)
- **One-click execution** — toggles `active: true` and runs the pipeline/section

## Installation & Usage

1. Open VS Code
2. Press `Ctrl+Shift+X` and search for **ETLX** (or install from `.vsix` during development)
3. Open any `.xmd`, `.etlxmd`, or `.eltx` file
4. Use the **▶ Run** buttons on sections or the global play button in the title bar

### Configuration

Go to **Settings** (`Ctrl+,`) and search for "ETLX":

- **`etlx.binaryPath`**  
  Full path to a custom `etlx-bin` executable. Leave empty to use the auto-downloaded version.

## Development

### Prerequisites
- Node.js
- VS Code

### Setup

```bash
git clone <your-repo>
cd etlx-vscode
npm install
```

### Build & Run

- **Compile**: `npm run compile`
- **Watch mode**: `npm run watch`
- **Launch**: Press `F5` (or Run → Start Debugging)

### Project Structure

```
etlx-vscode/
├── package.json
├── README.md
├── language-configuration.json
├── syntaxes/
│   └── etlx.tmLanguage.json
├── src/
│   └── extension.ts
├── .vscode/
│   └── launch.json
└── out/               (generated)
```

## How it works

- When you click **▶ Run** on a section:
  1. Automatically sets `active: true` in the nearest YAML block under that header
  2. Executes `etlx-bin --config <current-file>`

- The extension inherits **all default Markdown behavior** while adding ETLX-specific features.

## Roadmap

- Better YAML parsing (using `js-yaml`)
- Support for running subsections independently
- Output panel with structured logs
- Auto-detect latest binary from GitHub Releases
- Theme-specific colors for ETLX elements

## License

MIT

---

**Made for the [ETLX Project](https://realdatadriven.github.io/etlxdocs/)**

Feedback and contributions welcome!
```

---

### Final Folder Structure (Summary)

Now your extension should look like this:

```
etlx-vscode/
├── package.json
├── README.md
├── language-configuration.json
├── syntaxes/
│   └── etlx.tmLanguage.json
├── src/
│   └── extension.ts
├── .vscode/
│   └── launch.json
├── tsconfig.json
└── out/
```

**Ready to go!**

Just:
1. Create the `.vscode/launch.json` with the content above.
2. Create/replace `README.md` with the content above.
3. Open the folder in VS Code → Press **F5**.