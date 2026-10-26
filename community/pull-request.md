Add cozylove-girl/dsh-appearance-master

Adds an appearance management panel for DeepSeek Harness under `ui`. It manages installed skins, themes, backgrounds, and widgets in separate layers and saves appearance presets. It is a management interface rather than a skin or theme asset.

- Repository: https://github.com/cozylove-girl/dsh-appearance-master
- Published npm package: https://www.npmjs.com/package/dsh-appearance-master (initial version: 0.9.1).
- Declares `dsh.bundle.patch` and includes `cordis.patch.yml`.
- Includes host and Web client implementations, an MIT license, and offline checks (`npm test`).
- Repository has the `dsh-plugin` topic.
- This submission adds only `data/plugins/cozylove-girl__dsh-appearance-master.yml`.

Installation:

```bash
dsh plugin --profile desktop add dsh-appearance-master
```
