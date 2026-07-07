#!/usr/bin/env swift

import Foundation
import Vision
import Cocoa

guard CommandLine.arguments.count >= 2 else {
  print("Usage: swift vision-ocr.swift <image_path>")
  exit(1)
}

let imagePath = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: imagePath) else {
  print("ERROR: Cannot load image at \(imagePath)")
  exit(1)
}

guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  print("ERROR: Cannot get CGImage")
  exit(1)
}

let imgW = cgImage.width
let imgH = cgImage.height

let semaphore = DispatchSemaphore(value: 0)
var results: [[String: Any]] = []

let request = VNRecognizeTextRequest { request, error in
  if let error = error {
    print("ERROR: \(error.localizedDescription)")
    semaphore.signal()
    return
  }
  guard let observations = request.results as? [VNRecognizedTextObservation] else {
    semaphore.signal()
    return
  }
  for observation in observations {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let text = candidate.string
    let confidence = candidate.confidence
    // Vision bbox: bottom-left origin, normalized [0-1]
    let vb = observation.boundingBox
    let x = vb.origin.x * CGFloat(imgW)
    let y = CGFloat(imgH) - (vb.origin.y + vb.height) * CGFloat(imgH)
    let w = vb.width * CGFloat(imgW)
    let h = vb.height * CGFloat(imgH)
    results.append([
      "text": text,
      "confidence": confidence,
      "bbox": [Int(round(x)), Int(round(y)), Int(round(w)), Int(round(h))]
    ])
  }
  semaphore.signal()
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = false

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
semaphore.wait()

guard let jsonData = try? JSONSerialization.data(withJSONObject: results, options: []) else {
  print("ERROR: JSON serialization failed")
  exit(1)
}
print(String(data: jsonData, encoding: .utf8)!)
