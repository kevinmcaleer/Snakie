// Remove an image background using the macOS Vision framework's foreground
// instance mask (ML segmentation — keeps white silkscreen, drops the backdrop).
// Usage: rmbg <input> <output.png>
import Foundation
import Vision
import CoreImage
import AppKit

guard CommandLine.arguments.count >= 3 else {
    FileHandle.standardError.write("usage: rmbg <input> <output.png>\n".data(using: .utf8)!)
    exit(2)
}
let inPath = CommandLine.arguments[1]
let outPath = CommandLine.arguments[2]

guard let img = NSImage(contentsOfFile: inPath),
      let tiff = img.tiffRepresentation,
      let bmp = NSBitmapImageRep(data: tiff),
      let cg = bmp.cgImage else {
    FileHandle.standardError.write("ERROR: cannot load \(inPath)\n".data(using: .utf8)!)
    exit(1)
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("ERROR: vision perform failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}
guard let result = request.results?.first else {
    FileHandle.standardError.write("ERROR: no foreground subject detected\n".data(using: .utf8)!)
    exit(3)
}
FileHandle.standardError.write("instances: \(result.allInstances.count)\n".data(using: .utf8)!)

do {
    let masked = try result.generateMaskedImage(
        ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
    let ci = CIImage(cvPixelBuffer: masked)
    let ctx = CIContext()
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let outCG = ctx.createCGImage(ci, from: ci.extent, format: .RGBA8, colorSpace: space) else {
        FileHandle.standardError.write("ERROR: render failed\n".data(using: .utf8)!)
        exit(1)
    }
    let rep = NSBitmapImageRep(cgImage: outCG)
    guard let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("ERROR: png encode failed\n".data(using: .utf8)!)
        exit(1)
    }
    try png.write(to: URL(fileURLWithPath: outPath))
    FileHandle.standardError.write("wrote \(outPath)\n".data(using: .utf8)!)
} catch {
    FileHandle.standardError.write("ERROR: mask/render failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}
