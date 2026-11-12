import AVFoundation
import Foundation
import Speech

@available(macOS 26.0, iOS 26.0, *)
func recognizeSpeech(path: String, language: String) async throws -> String {
    let wanted = Locale(identifier: language)
    let supported = await DictationTranscriber.supportedLocales
    guard let locale = supported.first(where: { $0.identifier(.bcp47) == wanted.identifier(.bcp47) })
        ?? supported.first(where: { $0.language.languageCode == wanted.language.languageCode }) else {
        throw NSError(domain: "Voice", code: 1, userInfo: [NSLocalizedDescriptionKey: "This language is not supported for transcription on this device."])
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


import Vision

func recognizeImage(path: String) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if #available(macOS 13.0, iOS 16.0, *) { request.automaticallyDetectsLanguage = true }
    try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}
