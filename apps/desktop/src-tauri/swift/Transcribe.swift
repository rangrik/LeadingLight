import AVFoundation
import Foundation
import Speech

@main struct Transcribe {
    static func main() async {
        var result: [String: String]
        do {
            guard CommandLine.arguments.count == 3 else {
                throw NSError(domain: "Voice", code: 3, userInfo: [NSLocalizedDescriptionKey: "An audio file and language are required."])
            }
            if CommandLine.arguments[2] == "--image" {
                result = ["text": try recognizeImage(path: CommandLine.arguments[1])]
            } else if #available(macOS 26.0, *) {
                result = ["text": try await recognizeSpeech(path: CommandLine.arguments[1], language: CommandLine.arguments[2])]
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
