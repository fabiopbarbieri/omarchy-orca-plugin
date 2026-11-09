# Omarchy for Orca

An [Orca](https://github.com/stablyai/orca) plugin that makes Orca follow your [Omarchy](https://omarchy.org) theme: the app, the editor syntax and the terminal take the colors of the current Omarchy theme and change with it on every `omarchy theme set`.

[Português (Brasil)](#português-brasil)

## What it does

- Applies the current Omarchy theme as soon as Orca starts and again on every theme switch (usually under a second).
- Reads the palette with Omarchy's own `omarchy-theme-color --all`, so it gets the same aliases, the 16 ANSI colors and the light/dark mode that Omarchy resolves. Without that command it reads `colors.toml` and `ghostty.conf` directly.
- Editor syntax colors come from the `vscode-theme.json` that Omarchy generates for every theme.
- Shows the theme name in the status bar. Click it to reapply.
- Adds two commands: **Omarchy: Reapply current theme** and **Omarchy: Toggle following the theme**.

## Settings

Under **Settings → Plugins → Omarchy**:

| Setting | Default | Effect |
|---|---|---|
| Follow the Omarchy theme | on | Off stops applying; Orca keeps whatever theme you pick. |
| Light or dark | Same as the Omarchy theme | Forces dark or light if you want. |
| Sidebars, Tabs and dividers, Chat, Links, Diff, Git decorations, Charts | on | Off stops following Omarchy for that area; Orca derives those colors from the base colors instead. |
| Editor syntax | on | Off uses Orca's default syntax colors. |
| Terminal ANSI palette | on | Off keeps only background, text, cursor and selection from Omarchy. |

The settings labels are in English because Orca does not yet let plugins translate their manifest. Status bar text and command results follow the system language (English and Brazilian Portuguese).

## Install

Requires Orca 1.4.249 or newer, running on an Omarchy machine.

```bash
orca plugin install fabiopbarbieri/omarchy-orca-plugin
```

Orca shows what the plugin asks for and prints an approval fingerprint; run the command again with `--approve <fingerprint>`. You can also install it from **Settings → Plugins**.

The plugin runs as a `trusted-worker`, which means a Node.js process with your user's access. It asks for two capabilities only: its own settings (`settings:own`) and publishing app and terminal colors (`appearance:write`). It reads files under `~/.local/state/omarchy/current/` and runs `omarchy-theme-color`; it writes nothing and makes no network requests.

## How it works

`omarchy-theme-set` builds the new theme in a staging folder, renames it to `~/.local/state/omarchy/current/theme` and writes `theme.name` last. The worker watches that folder, waits for the burst of changes to settle, builds an Orca app theme (73 tokens plus up to ~80 syntax rules, kept under Orca's 16 KiB limit) and a terminal theme, and applies both with `appearance.apply`. A check every 30 seconds covers a missed file event.

## Development

```bash
orca plugin validate .
orca plugin dev load . --approve <fingerprint>
orca plugin logs local.omarchy
```

## License

[MIT](LICENSE)

---

## Português (Brasil)

Plugin do [Orca](https://github.com/stablyai/orca) que faz o Orca seguir o tema do [Omarchy](https://omarchy.org): a interface, a sintaxe do editor e o terminal usam as cores do tema atual e mudam junto a cada `omarchy theme set`.

**O que faz**

- Aplica o tema atual ao abrir o Orca e a cada troca de tema, em geral em menos de um segundo.
- A paleta vem do próprio `omarchy-theme-color --all`, com o modo claro/escuro e as 16 cores ANSI.
- Mostra o nome do tema na barra de status; clique para reaplicar.

**Configurações** (Configurações → Plugins → Omarchy)

- Seguir o tema: desligado, o Orca mantém o tema que você escolher.
- Claro ou escuro: segue o Omarchy ou força um dos dois.
- Grupos (barras laterais, abas, chat, links, diff, Git, gráficos, sintaxe, paleta do terminal): desligado, aquela área deixa de seguir o Omarchy.

Os rótulos das configurações ficam em inglês porque o Orca ainda não deixa plugins traduzirem o manifesto. A barra de status e as respostas dos comandos seguem o idioma do sistema.

**Instalar**

```bash
orca plugin install fabiopbarbieri/omarchy-orca-plugin
```

Depois repita o comando com `--approve <fingerprint>`, usando o código que o Orca mostrar.
