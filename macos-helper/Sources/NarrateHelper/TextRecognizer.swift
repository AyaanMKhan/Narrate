import Vision
import CoreGraphics

/// Runs Vision's text recognizer over a captured window image.
///
/// This is the app-agnostic core of the whole tool: it never touches the
/// Accessibility tree of the target app, so it works identically whether
/// the frontmost window is Preview.app rendering a PDFKit view, Zotero's
/// reader, or anything else — because it only ever looks at pixels.
enum TextRecognizer {

    enum RecognitionError: Error, CustomStringConvertible {
        case requestFailed(Error)
        case noTextFound

        var description: String {
            switch self {
            case .requestFailed(let error):
                return "Vision text request failed: \(error.localizedDescription)"
            case .noTextFound:
                return "No text was recognized in the captured window."
            }
        }
    }

    /// Recognizes text in `image` and returns it as a single string, lines
    /// joined in reading (top-to-bottom) order.
    ///
    /// Note on memory: `VNImageRequestHandler` and the `CGImage` it wraps
    /// are intentionally kept local to this function (not cached on any
    /// object) since repeated `VNRecognizeTextRequest` calls have a known
    /// memory-growth issue on recent macOS when request/handler instances
    /// are retained across calls. For a long-running menu-bar process,
    /// always create a fresh handler and request per capture, and let them
    /// fall out of scope immediately after use, as done here.
    static func recognizeText(in image: CGImage) throws -> String {
        var recognizedLines: [String] = []
        var thrown: Error?

        let request = VNRecognizeTextRequest { request, error in
            if let error = error {
                thrown = error
                return
            }
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                return
            }
            recognizedLines = observations.compactMap { $0.topCandidates(1).first?.string }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            throw RecognitionError.requestFailed(error)
        }

        if let thrown = thrown {
            throw RecognitionError.requestFailed(thrown)
        }

        let joined = recognizedLines.joined(separator: "\n")
        guard !joined.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw RecognitionError.noTextFound
        }
        return joined
    }
}
