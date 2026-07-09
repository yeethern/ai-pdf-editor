#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <Cocoa/Cocoa.h>

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr, "Usage: vision-ocr <image_path>\n");
      return 1;
    }

    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
    if (!image) {
      fprintf(stderr, "ERROR: Cannot load image\n");
      return 1;
    }

    CGImageRef cgImage = [image CGImageForProposedRect:NULL context:nil hints:nil];
    if (!cgImage) {
      fprintf(stderr, "ERROR: Cannot get CGImage\n");
      return 1;
    }

    size_t imgW = CGImageGetWidth(cgImage);
    size_t imgH = CGImageGetHeight(cgImage);

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSMutableArray *results = [NSMutableArray array];

    VNRecognizeTextRequest *req = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest *request, NSError *error) {
      if (error) {
        fprintf(stderr, "ERROR: %s\n", error.localizedDescription.UTF8String);
        dispatch_semaphore_signal(sem);
        return;
      }
      for (VNRecognizedTextObservation *obs in request.results) {
        VNRecognizedText *candidate = [obs topCandidates:1].firstObject;
        if (!candidate) continue;
        CGRect vb = obs.boundingBox;
        // Vision: bottom-left origin, normalized [0-1]
        // Convert to top-left origin pixel coords
        int x = (int)(vb.origin.x * imgW);
        int y = (int)(imgH - (vb.origin.y + vb.size.height) * imgH);
        int w = (int)(vb.size.width * imgW);
        int h = (int)(vb.size.height * imgH);
        float conf = candidate.confidence;
        NSString *text = candidate.string;
        NSMutableArray *charBboxes = [NSMutableArray array];
        for (NSUInteger i = 0; i < text.length; i++) {
          NSRange range = NSMakeRange(i, 1);
          NSError *err = nil;
          VNRectangleObservation *charObs = [candidate boundingBoxForRange:range error:&err];
          if (err || !charObs) {
            [charBboxes addObject:[NSNull null]];
            continue;
          }
          CGRect cb = charObs.boundingBox;
          int cx = (int)(cb.origin.x * imgW);
          int cy = (int)(imgH - (cb.origin.y + cb.size.height) * imgH);
          int cw = (int)(cb.size.width * imgW);
          int ch = (int)(cb.size.height * imgH);
          [charBboxes addObject:@[@(cx), @(cy), @(cw), @(ch)]];
        }
        [results addObject:@{
          @"text": text,
          @"confidence": @(conf),
          @"bbox": @[@(x), @(y), @(w), @(h)],
          @"charBboxes": charBboxes
        }];
      }
      dispatch_semaphore_signal(sem);
    }];

    req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    req.usesLanguageCorrection = YES;

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
    [handler performRequests:@[req] error:nil];
    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

    NSData *json = [NSJSONSerialization dataWithJSONObject:results options:0 error:nil];
    if (!json) {
      fprintf(stderr, "ERROR: JSON serialization failed\n");
      return 1;
    }
    fwrite(json.bytes, 1, json.length, stdout);
  }
  return 0;
}
