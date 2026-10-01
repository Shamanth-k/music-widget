# Music Widget

Music Widget is a lightweight Windows desktop companion that displays the current music session in a floating, draggable player. It reads Windows Global System Media Transport Controls (GSMTC), so no Spotify API key, Premium subscription, server, or account integration is needed.

## Features

- Artwork, title, artist, album, progress, and playback state
- Previous, play/pause, and next controls when supported by the current session
- Artwork derived dark colors, missing-art fallback, and smooth local progress interpolation
- Frameless, transparent, always-on-top window with position persistence
- Closing the widget hides it; the tray keeps the app running
- Tray actions for showing, hiding, settings, and quitting
- Persistent startup, visibility, playback-control, theme, and window settings
- Windows native GSMTC helper managed as an Electron child process

## Supported Windows versions

Windows 10 version 1809 or later and Windows 11. Applications need to publish a Windows media session for metadata and controls to be available. Video and unknown media types are ignored; classification relies on the session's GSMTC playback type metadata.

## Installation and portable version

Download `MusicWidget-Setup.exe` for the one-click installer or `MusicWidget-Portable.exe` to run without installing. The first release build may be unsigned, in which case Windows SmartScreen can show a reputation warning.

## Development

Requirements: Node.js 22+, npm, .NET 8 SDK, and Windows 10/11. Dependencies are already declared in `package-lock.json`.

```powershell
npm ci
npm run dev
```

Development mode starts Vite and Electron and displays mock metadata/artwork when there is no native session. Mock data is selected only in the renderer development build; production does not synthesize sessions. Use `npm run build` for the React production build, `npm run build:electron` for the Electron main process, `npm run test` for the shared model tests, and `npm run package:win` to publish the native helper and create both Windows artifacts.

## GitHub releases

The GitHub Actions workflow builds on Windows for version tags. Push a tag such as `v1.0.0`; the workflow compiles the .NET helper and attaches the installer and portable executable to the GitHub Release. It requires repository Actions and Releases permissions and no paid service.

## Architecture

The C# helper uses `GlobalSystemMediaTransportControlsSessionManager` and line-delimited JSON over stdin/stdout. It emits metadata, the media playback type, timeline and controls, and a data URL for artwork. Diagnostics go to stderr. Electron owns the child process, retries a failed helper a limited number of times, validates settings IPC, persists settings using electron-store, and exposes a narrow preload API. React does not access Node or Windows APIs.

## Manual Windows test checklist

- [ ] Spotify playing music; local MP3 player; paused and resumed playback
- [ ] Change song and verify metadata/artwork and progress update
- [ ] Close the music application; play and pause a video; check video does not show
- [ ] Move the widget, close it, restart the app, and verify position restoration
- [ ] Show/hide widget from tray; open settings; quit from tray
- [ ] Multiple media sessions; no active session; missing album artwork
- [ ] Test controls when each media app supports and does not support the action

## Limitations and troubleshooting

Only sessions provided by GSMTC can be read. The application cannot add support for a player that does not expose a Windows media session, and individual control capabilities depend on what that session advertises. If the widget stays hidden, check that a supported music application is playing and that the Windows media flyout shows its session. If the helper is unavailable, run `npm run build:bridge` from a Windows development environment with the .NET 8 SDK installed. Diagnostics from the helper are written to stderr.

## Privacy

Media metadata is read locally through Windows media sessions. The application has no cloud backend and does not upload song information. It does not capture raw system audio or use microphone-based recognition. No Spotify account is required. Artwork is received from the local media session and displayed in the widget.
