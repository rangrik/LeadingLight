import AVFoundation
import Foundation
import Speech

@available(macOS 26.0, *)
func transcribe(path: String, language: String) async throws -> String {
    let wanted = Locale(identifier: language)
    let supported = await DictationTranscriber.supportedLocales
    guard let locale = supported.first(where: { $0.identifier(.bcp47) == wanted.identifier(.bcp47) })
        ?? supported.first(where: { $0.language.languageCode == wanted.language.languageCode }) else {
        throw NSError(domain: "Voice", code: 1, userInfo: [NSLocalizedDescriptionKey: "This language is not supported for transcription on this Mac."])
    }
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 16_384) else {
        throw NSError(domain: "Voice", code: 2, userInfo: [NSLocalizedDescriptionKey: "The recording could not be read."])
    }
    // Silence must never become guessed words. Scan bounded chunks before starting recognition.
    var audible = false
    while file.framePosition < file.length {
        try file.read(into: buffer)
        if buffer.frameLength == 0 { break }
        if let samples = buffer.floatChannelData {
            for channel in 0..<Int(buffer.format.channelCount) {
                for frame in 0..<Int(buffer.frameLength) where abs(samples[channel][frame]) > 0.003 {
                    audible = true
                    break
                }
                if audible { break }
            }
        }
        if audible { break }
    }
    guard audible else { return "" }
    file.framePosition = 0
    let transcriber = DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await request.downloadAndInstall()
    }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let collector = Task<String, Error> {
        var parts: [String] = []
        for try await result in transcriber.results where result.isFinal {
            parts.append(String(result.text.characters))
        }
        return parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    do {
        try await analyzer.start(inputAudioFile: file, finishAfterFile: true)
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        return try await collector.value
    } catch {
        collector.cancel()
        await analyzer.cancelAndFinishNow()
        throw error
    }
}

@main struct Transcribe {
    static func main() async {
        var result: [String: String]
        do {
            guard CommandLine.arguments.count == 3 else {
                throw NSError(domain: "Voice", code: 3, userInfo: [NSLocalizedDescriptionKey: "An audio file and language are required."])
            }
            if #available(macOS 26.0, *) {
                result = ["text": try await transcribe(path: CommandLine.arguments[1], language: CommandLine.arguments[2])]
            } else {
                result = ["error": "Transcription requires macOS 26 or newer. Your recording is saved."]
            }
        } catch {
            result = ["error": error.localizedDescription]
        }
        if let data = try? JSONSerialization.data(withJSONObject: result) {
            FileHandle.standardOutput.write(data)
        }
    }
}
