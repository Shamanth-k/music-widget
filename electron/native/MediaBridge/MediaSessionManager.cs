using System.Text.Json;
using Windows.Media;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace MusicWidget.MediaBridge;

internal sealed class MediaSessionManager : IDisposable
{
    private const int ProtocolVersion = 1;
    private readonly GlobalSystemMediaTransportControlsSessionManager _manager;
    private readonly HashSet<GlobalSystemMediaTransportControlsSession> _observed = [];
    private readonly SemaphoreSlim _publishLock = new(1, 1);
    private GlobalSystemMediaTransportControlsSession? _current;
    private GlobalSystemMediaTransportControlsSession? _classifiedSession;
    private string _classifiedPlaybackType = "unknown";

    private MediaSessionManager(GlobalSystemMediaTransportControlsSessionManager manager) => _manager = manager;

    public static async Task<MediaSessionManager> CreateAsync()
    {
        var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        return new MediaSessionManager(manager);
    }

    public async Task StartAsync()
    {
        _manager.CurrentSessionChanged += (_, _) => _ = SelectCurrentSafelyAsync("current_session_changed");
        _manager.SessionsChanged += (_, _) => _ = SelectCurrentSafelyAsync("sessions_changed");
        ObserveSessions();
        Status("initialized", details: $"sessions={_manager.GetSessions().Count}");
        await SelectCurrentSafelyAsync("initial_selection");
    }

    private void ObserveSessions()
    {
        foreach (var session in _manager.GetSessions())
        {
            if (!_observed.Add(session)) continue;
            session.MediaPropertiesChanged += (_, _) => _ = PublishCurrentSafelyAsync("media_properties_changed");
            session.PlaybackInfoChanged += (_, _) => _ = PublishCurrentSafelyAsync("playback_info_changed");
            session.TimelinePropertiesChanged += (_, _) => _ = PublishCurrentSafelyAsync("timeline_changed");
            Status("session_observed", session, details: "subscribed to media properties, playback, and timeline events");
        }
    }

    private async Task SelectCurrentSafelyAsync(string reason)
    {
        try
        {
            ObserveSessions();
            _current = _manager.GetCurrentSession();
            Status("session_selected", _current, _current is not null, reason);
            await PublishCurrentAsync();
        }
        catch (Exception exception) { ReportError("session_selection_failed", exception); }
    }

    private async Task PublishCurrentSafelyAsync(string reason)
    {
        try
        {
            if (_current is null || !ReferenceEquals(_current, _manager.GetCurrentSession())) await SelectCurrentSafelyAsync(reason);
            else await PublishCurrentAsync();
        }
        catch (Exception exception) { ReportError($"{reason}_failed", exception); }
    }

    public async Task PublishCurrentAsync()
    {
        await _publishLock.WaitAsync();
        try
        {
            var session = _manager.GetCurrentSession();
            _current = session;
            if (session is null)
            {
                _classifiedSession = null;
                _classifiedPlaybackType = "unknown";
                Status("session_not_found", sessionFound: false);
                Write(new { protocolVersion = ProtocolVersion, type = "media_update", data = (object?)null });
                return;
            }

            var source = session.SourceAppUserModelId;
            var media = await session.TryGetMediaPropertiesAsync();
            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();
            var kind = PlaybackType(media.PlaybackType);
            _classifiedSession = session;
            _classifiedPlaybackType = kind;
            Status("media_properties_received", session, true, $"title={media.Title}; artist={media.Artist}; playbackType={kind}");
            Status("timeline_received", session, true, $"position={timeline.Position.TotalSeconds:0.###}; start={timeline.StartTime.TotalSeconds:0.###}; end={timeline.EndTime.TotalSeconds:0.###}");

            if (kind != "music")
            {
                Status("session_ignored", session, true, $"music-only filter rejected playbackType={kind}");
                Write(new { protocolVersion = ProtocolVersion, type = "media_update", data = (object?)null });
                return;
            }

            var position = Math.Max(0, timeline.Position.TotalSeconds);
            var duration = Math.Max(0, (timeline.EndTime - timeline.StartTime).TotalSeconds);
            var artwork = await ReadArtworkAsync(media.Thumbnail);
            var data = new
            {
                title = Empty(media.Title, "Unknown title"),
                artist = Empty(media.Artist, "Unknown artist"),
                album = Empty(media.AlbumTitle, ""),
                artwork,
                playbackType = "music",
                playbackStatus = playback.PlaybackStatus switch
                {
                    GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing => "playing",
                    GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused => "paused",
                    GlobalSystemMediaTransportControlsSessionPlaybackStatus.Stopped => "stopped",
                    _ => "unknown"
                },
                position,
                duration,
                canPlayPause = playback.Controls.IsPlayPauseToggleEnabled || playback.Controls.IsPauseEnabled || playback.Controls.IsPlayEnabled,
                canPrevious = playback.Controls.IsPreviousEnabled,
                canNext = playback.Controls.IsNextEnabled
            };
            Write(new { protocolVersion = ProtocolVersion, type = "media_update", data });
        }
        catch (Exception exception)
        {
            ReportError("media_update_failed", exception);
            Write(new { protocolVersion = ProtocolVersion, type = "media_update", data = (object?)null });
        }
        finally { _publishLock.Release(); }
    }

    public async Task ControlAsync(string command)
    {
        try
        {
            var session = _manager.GetCurrentSession();
            _current = session;
            if (session is null)
            {
                CommandResult(command, false, "no_session", "No current GSMTC session is available.");
                return;
            }

            if (!ReferenceEquals(session, _classifiedSession))
            {
                CommandResult(command, false, "session_not_ready", "The current session has not supplied media properties yet.");
                _ = PublishCurrentSafelyAsync("command_session_refresh");
                return;
            }
            if (_classifiedPlaybackType != "music")
            {
                CommandResult(command, false, "not_music", $"Current session playback type is '{_classifiedPlaybackType}'; music-only control was not sent.");
                return;
            }

            // Invoke the GSMTC operation before the first await. This keeps the COM call
            // on the STA command thread instead of resuming after a media-properties await.
            Windows.Foundation.IAsyncOperation<bool>? operation = command switch
            {
                "play_pause" => session.TryTogglePlayPauseAsync(),
                "next" => session.TrySkipNextAsync(),
                "previous" => session.TrySkipPreviousAsync(),
                _ => null
            };
            if (operation is null) { CommandResult(command, false, "unknown_command", $"Unsupported command '{command}'."); return; }
            var succeeded = await operation;
            if (succeeded) Status("command_succeeded", session, true, command);
            else CommandResult(command, false, "control_rejected", "The GSMTC session rejected the playback command.");
            if (succeeded) CommandResult(command, true);
        }
        catch (Exception exception) { CommandResult(command, false, "native_exception", exception.Message, exception); }
    }

    public void ReportCommandError(string command, string code, string message) => CommandResult(command, false, code, message);

    private static string PlaybackType(MediaPlaybackType? type) => type switch
    {
        MediaPlaybackType.Music => "music",
        MediaPlaybackType.Video or MediaPlaybackType.Image => "video",
        _ => "unknown"
    };

    private static async Task<string?> ReadArtworkAsync(IRandomAccessStreamReference? thumbnail)
    {
        if (thumbnail is null) return null;
        try
        {
            using var stream = await thumbnail.OpenReadAsync();
            if (stream.Size is 0 or > 8_000_000) return null;
            using var reader = new DataReader(stream.GetInputStreamAt(0));
            await reader.LoadAsync((uint)stream.Size);
            var bytes = new byte[(int)stream.Size]; reader.ReadBytes(bytes);
            var mime = bytes.AsSpan().StartsWith(new byte[] { 0x89, 0x50, 0x4e, 0x47 }) ? "image/png" :
                bytes.AsSpan().StartsWith(new byte[] { 0x52, 0x49, 0x46, 0x46 }) ? "image/webp" : "image/jpeg";
            return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        }
        catch (Exception exception) { ReportError("artwork_unavailable", exception); return null; }
    }

    private static void Status(string stage, GlobalSystemMediaTransportControlsSession? session = null, bool? sessionFound = null, string? details = null)
    {
        Write(new
        {
            protocolVersion = ProtocolVersion,
            type = "bridge_status",
            stage,
            sessionFound,
            sourceAppId = session?.SourceAppUserModelId,
            details
        });
    }

    public void ReportStatus(string stage, string? details = null) => Status(stage, details: details);

    private static void CommandResult(string command, bool success, string? code = null, string? message = null, Exception? exception = null)
    {
        if (exception is null && code is null)
        {
            Write(new { protocolVersion = ProtocolVersion, type = "command_result", command, success });
            return;
        }
        Write(new
        {
            protocolVersion = ProtocolVersion,
            type = "command_result",
            command,
            success,
            error = new
            {
                code = code ?? "native_exception",
                message = message ?? exception?.Message ?? "Unknown native error",
                exceptionType = exception?.GetType().FullName,
                hresult = exception is null ? null : $"0x{exception.HResult:X8}"
            }
        });
    }

    private static void ReportError(string code, Exception exception)
    {
        var error = new
        {
            code,
            message = exception.Message,
            exceptionType = exception.GetType().FullName,
            hresult = $"0x{exception.HResult:X8}"
        };
        Console.Error.WriteLine($"MediaBridge {code}: {exception}");
        Write(new { protocolVersion = ProtocolVersion, type = "bridge_error", error });
    }

    private static string Empty(string? value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value;
    private static void Write(object message) { Console.Out.WriteLine(JsonSerializer.Serialize(message)); Console.Out.Flush(); }
    public void Dispose() => _publishLock.Dispose();
}
