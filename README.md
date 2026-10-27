# Zotero-for-WordCraft

Cite Zotero items straight into a running [WordCraft](https://github.com/storytold/wordcraft) document.

Select references in Zotero, right-click, and choose **Cite in WordCraft**. The citation is formatted by Zotero's own citation engine, so any style installed in Zotero works (APA, IEEE, Chicago and more). It reaches WordCraft over the local control port; nothing leaves your computer.

> Unofficial community add-on. Not affiliated with Zotero or the WordCraft team.

## Status

**v0.1.0, early release.** The protocol layer is unit-tested against a mock of WordCraft's control channel. The Zotero-side menus and citation formatting are new and still need field testing. Please open an issue with the exact message shown if something breaks.

## Features

- **Cite in WordCraft**: inserts the in-text citation at the caret
- **Insert Bibliography in WordCraft**: inserts the formatted reference entries
- **Tools > WordCraft: Test Connection**: checks the port and key
- **Tools > WordCraft: Save Command List**: saves WordCraft's command ids to `wordcraft-commands.json`

## Requirements

- Zotero 7 or newer
- [WordCraft](https://github.com/storytold/wordcraft/releases/latest), started with its control port
- Windows, macOS or Linux (Windows steps below)

## Install

1. Download `wordcraft-zotero-0.1.0.xpi` from the [latest release](https://github.com/peash182/Zotero-for-WordCraft/releases/latest).
2. Start WordCraft with its control port. From the folder containing `wordcraft.exe`:
   ```
   .\wordcraft.exe --control 7981
   ```
3. In Zotero, open **Tools > Plugins**, click the gear icon, choose **Install Plugin From File**, and select the `.xpi`.
4. Run **Tools > WordCraft: Test Connection**.

Then put the caret in your WordCraft document, select items in Zotero, right-click, and choose **Cite in WordCraft**.

## Settings

Set these in Zotero's Config Editor (Settings > Advanced).

| Preference | Default | Meaning |
|---|---|---|
| `extensions.wordcraft.port` | `7981` | Port passed to `wordcraft --control` |
| `extensions.wordcraft.style` | empty | Style URL, e.g. `http://www.zotero.org/styles/ieee`. Empty uses your Quick Copy style |
| `extensions.wordcraft.key` | empty | Control key override. Normally read from WordCraft's `control-key.local-<port>` file |

## Known limits

- Citations are inserted as **plain text** via WordCraft's `text.insert` command: no italics, no live citation fields yet.
- WordCraft installed through Flatpak keeps its key file where Zotero can't read it; copy the key into `extensions.wordcraft.key`.

## Build and test

```
zip -X -r wordcraft-zotero-0.1.0.xpi manifest.json bootstrap.js prefs.js content
node test/protocol.test.js
```

## Roadmap

- Use WordCraft's native citation and bibliography commands instead of plain text
- Live citation fields that update when the style changes
- A settings pane instead of the Config Editor

Feedback and pull requests are welcome.

## Discussion and feedback:
- https://www.researchgate.net/post/Do_you_want_to_cite_from_Zotero_while_writing_in_an_open-source_word_processor_WordCraft_I_built_an_add-on_and_need_testers
