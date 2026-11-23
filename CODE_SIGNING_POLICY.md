# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## What gets signed

Only the Windows files built from this repository by its GitHub Actions workflow ([`.github/workflows/build.yml`](.github/workflows/build.yml)):

- `Briar.exe`, the application inside the installer;
- `Briar-Setup.exe`, the installer;
- `Briar-Portable.exe`, the portable executable.

Every release is built from a commit on the `main` branch, on GitHub-hosted runners, from the source code in this repository. Nothing is signed from a developer's machine. Third-party components bundled by Electron keep their upstream signatures, or none; they are not re-signed under this policy.

## Team roles

- Committers and reviewers: [JoaoManieri](https://github.com/JoaoManieri)
- Approvers: [JoaoManieri](https://github.com/JoaoManieri)

Every person with write access to this repository uses multi-factor authentication on GitHub and on SignPath. Release signing requests are approved manually by an approver.

## Privacy policy

Briar has no telemetry and sends no information to its developers. It only connects to other systems in these cases:

- **Git remotes you choose.** Fetch, pull, push and clone talk to the servers configured in your repositories, with your own credentials.
- **GitHub, if you connect an account.** Signing in happens on github.com in your browser. Briar then uses the GitHub API to list your repositories and to suggest the name and email for your commits. The token stays on your computer, encrypted by the operating system's keychain (or only in memory, when there is no keychain).
- **Update checks.** On launch and every 4 hours, Briar asks this repository's GitHub Releases whether a newer version exists and, on the installer, AppImage and .deb builds, downloads it.
- **Installing Git, only when you click "Instalar o Git".** On Windows, through winget or the official Git for Windows installer from its GitHub releases; on Linux, through your distribution's package manager.

## Reporting a problem

If you believe a signed Briar file was tampered with, or that the signing process was misused, open an issue in this repository.
