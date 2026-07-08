#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <Cocoa/Cocoa.h>

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr, "Usage: vision-qr <image_path>\n");
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

    VNDetectBarcodesRequest *req = [[VNDetectBarcodesRequest alloc] initWithCompletionHandler:^(VNRequest *request, NSError *error) {
      if (error) {
        fprintf(stderr, "ERROR: %s\n", error.localizedDescription.UTF8String);
        dispatch_semaphore_signal(sem);
        return;
      }

      for (VNBarcodeObservation *obs in request.results) {
        if (![obs.symbology isEqualToString:VNBarcodeSymbologyQR]) continue;

        NSString *content = obs.payloadStringValue;
        if (!content) continue;

        CGRect bb = obs.boundingBox;
        // Vision: bottom-left origin, normalized [0-1]
        // Convert to top-left origin pixel coords
        int x = (int)(bb.origin.x * imgW);
        int y = (int)(imgH - (bb.origin.y + bb.size.height) * imgH);
        int w = (int)(bb.size.width * imgW);
        int h = (int)(bb.size.height * imgH);

        NSMutableArray *corners = [NSMutableArray array];
        [corners addObject:@[@((int)(obs.topLeft.x * imgW)), @((int)(imgH - obs.topLeft.y * imgH))]];
        [corners addObject:@[@((int)(obs.topRight.x * imgW)), @((int)(imgH - obs.topRight.y * imgH))]];
        [corners addObject:@[@((int)(obs.bottomRight.x * imgW)), @((int)(imgH - obs.bottomRight.y * imgH))]];
        [corners addObject:@[@((int)(obs.bottomLeft.x * imgW)), @((int)(imgH - obs.bottomLeft.y * imgH))]];

        [results addObject:@{
          @"content": content,
          @"boundingBox": @[@(x), @(y), @(w), @(h)],
          @"corners": corners,
        }];
      }

      dispatch_semaphore_signal(sem);
    }];

    req.symbologies = @[VNBarcodeSymbologyQR];

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