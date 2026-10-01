# Music Widget

A lightweight Windows floating music widget that automatically appears
when music is playing.

Music Widget uses Windows' built-in media session system to detect
supported music applications and display the currently playing track
without accessing or recording the audio itself.

## Features

-   Automatically detects supported music sessions
-   Shows album artwork
-   Displays song title and artist
-   Playback progress and timeline
-   Play / Pause controls
-   Previous / Next track controls
-   Automatically appears when music starts
-   Automatically hides when no music session is active
-   Paused music remains visible
-   Close button hides the widget without stopping playback
-   Always-on-top floating window
-   Draggable widget
-   Remembers widget position
-   System tray support
-   Dynamic background based on album artwork
-   Runs in the background
-   No Spotify API
-   No Spotify OAuth
-   No premium account requirement
-   No audio recording or raw audio capture

## Download

Download the latest Windows release from the project's Releases page.

### Windows Installer

**MusicWidget-Setup.exe**

Recommended for most users.

The installer creates the application and desktop shortcut
automatically.

### Portable Version

**MusicWidget-Portable.exe**

Run the application without installing it.

## How It Works

Music Widget uses the Windows Global System Media Transport Controls
(GSMTC) system.

``` text
Music Application
       │
       ▼
Windows Media Session
       │
       ▼
C# MediaBridge
       │
       ▼
Electron Main Process
       │
       ▼
Secure IPC / Preload
       │
       ▼
React UI
```

The application reads media metadata provided by Windows, such as:

-   Song title
-   Artist
-   Album
-   Album artwork
-   Playback state
-   Playback position
-   Track duration

Playback commands are also sent through Windows' media session controls.

Music Widget does **not** capture the audio stream.

## Supported Media

Music Widget works with applications that expose their playback
information through Windows Media Session / GSMTC.

This can include:

-   Spotify
-   Windows-supported music players
-   Other applications that expose Windows media controls

Support depends on whether the application provides media metadata
through Windows.

Video sessions are intentionally ignored so that watching videos does
not unnecessarily open the widget.

## Requirements

-   Windows 10 or later
-   64-bit Windows
-   An application that exposes Windows media session information

No separate runtime installation is required for the packaged
application.

## Installation

1.  Download `MusicWidget-Setup.exe` from the latest release.
2.  Run the installer.
3.  Launch **Music Widget**.
4.  Start playing music in a supported application.
5.  The widget will automatically appear.

The application can continue running in the system tray even when the
widget itself is hidden.

## System Tray

When the widget is running, it can be controlled from the Windows system
tray.

Available actions include:

-   Show
-   Hide
-   Settings
-   Quit

Closing the widget does not stop the music.

## Settings

The application provides settings for:

-   Start with Windows
-   Always on top
-   Remember widget position
-   Show when music starts
-   Hide delay
-   Playback controls
-   Theme intensity

## Technology

### Frontend

-   React
-   TypeScript
-   Vite
-   CSS

### Desktop

-   Electron
-   Electron Store

### Windows Media Integration

-   C#
-   .NET 8
-   Windows Global System Media Transport Controls (GSMTC)

### Packaging

-   electron-builder
-   NSIS
-   Portable Windows build

### CI/CD

-   GitHub Actions
-   GitHub Releases

## Project Structure

``` text
music-widget/
│
├── .github/
│   └── workflows/
│       └── release.yml
│
├── build/
│   ├── icon.ico
│   └── music-widget-icon.png
│
├── electron/
│   ├── main.ts
│   ├── mediaBridge.ts
│   ├── mediaModel.ts
│   ├── preload.cjs
│   │
│   └── native/
│       └── MediaBridge/
│           ├── MediaBridge.csproj
│           ├── MediaSessionManager.cs
│           └── Program.cs
│
├── public/
├── src/
├── tests/
│
├── electron-builder.yml
├── package.json
├── package-lock.json
└── vite.config.ts
```

## Development

### Prerequisites

Install:

-   Node.js
-   npm
-   .NET 8 SDK

### Clone the repository

``` bash
git clone https://github.com/Shamanth-k/music-widget.git
cd music-widget
```

### Install dependencies

``` bash
npm install
```

### Run the application in development

``` bash
npm run dev
```

### Run tests

``` bash
npm test
```

### Build the frontend

``` bash
npm run build
```

### Build the Electron process

``` bash
npm run build:electron
```

### Build the Windows MediaBridge

``` bash
npm run build:bridge
```

### Build Windows releases

``` bash
npm run package:win
```

The generated files are placed in:

``` text
release/
```

## Release Pipeline

Windows releases are automatically built using GitHub Actions.

Creating a version tag such as:

``` bash
git tag v1.0.0
git push origin v1.0.0
```

triggers the release workflow.

The workflow:

1.  Sets up Windows
2.  Installs Node.js
3.  Installs .NET 8
4.  Installs npm dependencies
5.  Runs tests
6.  Builds the React application
7.  Builds the Electron process
8.  Publishes the C# MediaBridge
9.  Builds the Windows installer
10. Builds the portable executable
11. Publishes the executables to GitHub Releases

## Architecture

``` text
┌─────────────────────────────┐
│       Music Application     │
│   Spotify / Music Player    │
└──────────────┬──────────────┘
               │
               │ Windows Media Session
               ▼
┌─────────────────────────────┐
│       C# MediaBridge        │
│       .NET 8 + GSMTC        │
└──────────────┬──────────────┘
               │
               │ JSON messages
               ▼
┌─────────────────────────────┐
│      Electron Main          │
│        Process              │
└──────────────┬──────────────┘
               │
               │ Secure IPC
               ▼
┌─────────────────────────────┐
│       React Renderer        │
│                             │
│  Album Art                  │
│  Song Information           │
│  Progress                   │
│  Playback Controls          │
└─────────────────────────────┘
```

## Privacy

Music Widget does not:

-   Record audio
-   Capture microphone input
-   Upload music
-   Download music
-   Use the Spotify Web API
-   Require Spotify OAuth
-   Store Spotify credentials
-   Send song information to a remote backend

The application communicates locally with Windows media sessions.

## Limitations

Music Widget depends on Windows Media Session support.

If a music application does not expose its playback information through
Windows, Music Widget may not be able to display its:

-   Song title
-   Artist
-   Album artwork
-   Playback state
-   Timeline

This is a limitation of the media application's Windows integration
rather than the widget itself.

## License

This project is currently distributed without a published open-source
license.

See the repository for the current project status and release
information.

## Author

**Shamanth Krishna V R**

GitHub: `Shamanth-k`

------------------------------------------------------------------------

## Release

**v1.0.0**

Initial public release of Music Widget for Windows.
