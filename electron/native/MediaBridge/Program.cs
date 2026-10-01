using System.Text;
using System.Text.Json;
using MusicWidget.MediaBridge;

internal static class Program
{
    private const int ProtocolVersion = 1;

    [STAThread]
    private static int Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        Write(new { protocolVersion = ProtocolVersion, type = "bridge_status", stage = "started", details = $"pid={Environment.ProcessId}; runtime={Environment.Version}; apartment={Thread.CurrentThread.GetApartmentState()}" });

        MediaSessionManager manager;
        try
        {
            manager = MediaSessionManager.CreateAsync().GetAwaiter().GetResult();
            manager.StartAsync().GetAwaiter().GetResult();
        }
        catch (Exception exception)
        {
            ReportError("initialization_failed", exception);
            return 1;
        }

        string? line;
        while ((line = Console.In.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            string? command = null;
            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("command", out var commandValue) || commandValue.ValueKind != JsonValueKind.String)
                {
                    WriteError("invalid_command", "Expected a JSON object with a string 'command' property.");
                    continue;
                }
                command = commandValue.GetString();
                manager.ReportStatus("command_received", command);
                if (command == "shutdown")
                {
                    manager.ReportStatus("shutdown_requested");
                    break;
                }
                if (command == "get_current") manager.PublishCurrentAsync().GetAwaiter().GetResult();
                else if (command is "play_pause" or "next" or "previous") manager.ControlAsync(command).GetAwaiter().GetResult();
                else manager.ReportCommandError(command ?? "", "unknown_command", $"Unsupported command '{command}'.");
            }
            catch (JsonException exception) { WriteError("invalid_json", exception.Message, exception); }
            catch (Exception exception)
            {
                if (command is "play_pause" or "next" or "previous") manager.ReportCommandError(command, "command_handler_exception", exception.Message);
                else WriteError("command_handler_exception", exception.Message, exception);
            }
        }

        manager.Dispose();
        return 0;
    }

    private static void Write(object message) { Console.Out.WriteLine(JsonSerializer.Serialize(message)); Console.Out.Flush(); }
    private static void WriteError(string code, string message, Exception? exception = null) => Write(new
    {
        protocolVersion = ProtocolVersion,
        type = "bridge_error",
        error = new { code, message, exceptionType = exception?.GetType().FullName, hresult = exception is null ? null : $"0x{exception.HResult:X8}" }
    });
    private static void ReportError(string code, Exception exception)
    {
        Console.Error.WriteLine($"MediaBridge {code}: {exception}");
        WriteError(code, exception.Message, exception);
    }
}
