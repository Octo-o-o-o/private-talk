#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

/*
 * iOS-native audio bridge.
 *
 * WKWebView's MediaRecorder / AVCaptureSession capture path has been
 * historically unstable in Tauri shells (codec gaps, permission flapping
 * between background transitions, no AVAudioSession control). On Apple
 * platforms the standard pattern is:
 *
 *   - record with AVAudioRecorder targeting an AAC-encoded .m4a file
 *   - play back with AVAudioPlayer
 *   - share a single AVAudioSession so the system can route to AirPods /
 *     CarPlay and respect the silent switch / "Do Not Disturb" mode
 *
 * This file exposes a tiny C API to the Rust side:
 *
 *   pt_audio_start_recording(out_error)              -> BOOL
 *   pt_audio_stop_recording(out_b64, out_mime, err)  -> BOOL
 *   pt_audio_play_base64(b64, mime, out_error)       -> BOOL
 *   pt_audio_stop_playback()                         -> void
 *
 * Strings handed back through the out-params are heap-allocated with
 * strdup(); the Rust side is responsible for freeing via pt_audio_string_free.
 */

#pragma mark - Audio session helpers

static BOOL pt_audio_configure_session_for_record(NSError **error) {
    AVAudioSession *session = [AVAudioSession sharedInstance];
    if (![session setCategory:AVAudioSessionCategoryPlayAndRecord
                         mode:AVAudioSessionModeSpokenAudio
                      options:AVAudioSessionCategoryOptionDefaultToSpeaker |
                              AVAudioSessionCategoryOptionAllowBluetooth
                        error:error]) {
        return NO;
    }
    return [session setActive:YES error:error];
}

static BOOL pt_audio_configure_session_for_playback(NSError **error) {
    AVAudioSession *session = [AVAudioSession sharedInstance];
    if (![session setCategory:AVAudioSessionCategoryPlayback
                         mode:AVAudioSessionModeSpokenAudio
                      options:0
                        error:error]) {
        return NO;
    }
    return [session setActive:YES error:error];
}

static void pt_audio_deactivate_session(void) {
    AVAudioSession *session = [AVAudioSession sharedInstance];
    NSError *deactivateError = nil;
    [session setActive:NO
          withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                error:&deactivateError];
    // We don't surface the deactivate error; it's expected to fail when
    // another session is already inactive, and it doesn't affect correctness.
}

static char *pt_audio_strdup_ns(NSString *s) {
    if (s == nil) {
        return NULL;
    }
    const char *utf8 = s.UTF8String;
    if (utf8 == NULL) {
        return NULL;
    }
    return strdup(utf8);
}

#pragma mark - Recorder

@interface PTAudioRecorder : NSObject <AVAudioRecorderDelegate>
@property (nonatomic, strong) AVAudioRecorder *recorder;
@property (nonatomic, copy) NSURL *currentURL;
@end

@implementation PTAudioRecorder

+ (instancetype)shared {
    static PTAudioRecorder *instance;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        instance = [PTAudioRecorder new];
    });
    return instance;
}

- (BOOL)startWithError:(NSError **)error {
    if (self.recorder.isRecording) {
        // Reset before starting again — calling -record on a stale recorder
        // can leave a half-written file behind.
        [self.recorder stop];
        self.recorder = nil;
        self.currentURL = nil;
    }

    if (!pt_audio_configure_session_for_record(error)) {
        return NO;
    }

    NSString *tmpDir = NSTemporaryDirectory();
    NSString *filename =
        [NSString stringWithFormat:@"pt-recording-%@.m4a", [NSUUID UUID].UUIDString];
    NSURL *url = [NSURL fileURLWithPath:[tmpDir stringByAppendingPathComponent:filename]];

    NSDictionary *settings = @{
        AVFormatIDKey: @(kAudioFormatMPEG4AAC),
        AVSampleRateKey: @16000.0,
        AVNumberOfChannelsKey: @1,
        AVEncoderAudioQualityKey: @(AVAudioQualityMedium),
    };

    AVAudioRecorder *recorder =
        [[AVAudioRecorder alloc] initWithURL:url settings:settings error:error];
    if (recorder == nil) {
        return NO;
    }
    recorder.delegate = self;
    if (![recorder prepareToRecord]) {
        if (error != NULL && *error == nil) {
            *error = [NSError errorWithDomain:@"PTAudioRecorder"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    @"prepareToRecord failed"}];
        }
        return NO;
    }
    if (![recorder record]) {
        if (error != NULL && *error == nil) {
            *error = [NSError errorWithDomain:@"PTAudioRecorder"
                                         code:-2
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    @"record returned NO"}];
        }
        return NO;
    }

    self.recorder = recorder;
    self.currentURL = url;
    return YES;
}

- (NSData * _Nullable)stopAndReadDataWithError:(NSError **)error {
    if (self.recorder == nil || !self.recorder.isRecording) {
        if (error != NULL) {
            *error = [NSError errorWithDomain:@"PTAudioRecorder"
                                         code:-3
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    @"no active recording"}];
        }
        return nil;
    }
    [self.recorder stop];
    NSURL *url = self.currentURL;
    self.recorder = nil;
    self.currentURL = nil;

    pt_audio_deactivate_session();

    if (url == nil) {
        return nil;
    }
    NSData *data = [NSData dataWithContentsOfURL:url options:0 error:error];
    // Best-effort cleanup of the temp file.
    [[NSFileManager defaultManager] removeItemAtURL:url error:NULL];
    return data;
}

@end

#pragma mark - Player

@interface PTAudioPlayer : NSObject <AVAudioPlayerDelegate>
@property (nonatomic, strong) AVAudioPlayer *player;
@end

@implementation PTAudioPlayer

+ (instancetype)shared {
    static PTAudioPlayer *instance;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        instance = [PTAudioPlayer new];
    });
    return instance;
}

- (BOOL)playData:(NSData *)data error:(NSError **)error {
    if (data == nil || data.length == 0) {
        if (error != NULL) {
            *error = [NSError errorWithDomain:@"PTAudioPlayer"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    @"empty audio data"}];
        }
        return NO;
    }
    [self stop];

    if (!pt_audio_configure_session_for_playback(error)) {
        return NO;
    }

    AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithData:data error:error];
    if (player == nil) {
        return NO;
    }
    player.delegate = self;
    [player prepareToPlay];
    if (![player play]) {
        if (error != NULL && *error == nil) {
            *error = [NSError errorWithDomain:@"PTAudioPlayer"
                                         code:-2
                                     userInfo:@{NSLocalizedDescriptionKey:
                                                    @"play returned NO"}];
        }
        return NO;
    }
    self.player = player;
    return YES;
}

- (void)stop {
    if (self.player != nil) {
        [self.player stop];
        self.player = nil;
        pt_audio_deactivate_session();
    }
}

- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer *)player successfully:(BOOL)flag {
    if (player == self.player) {
        self.player = nil;
        pt_audio_deactivate_session();
    }
}

@end

#pragma mark - C ABI exported to Rust

__attribute__((visibility("default")))
BOOL pt_audio_start_recording(char **out_error) {
    NSError *error = nil;
    BOOL ok = [[PTAudioRecorder shared] startWithError:&error];
    if (!ok && out_error != NULL) {
        *out_error = pt_audio_strdup_ns(error.localizedDescription);
    }
    return ok;
}

__attribute__((visibility("default")))
BOOL pt_audio_stop_recording(char **out_base64, char **out_mime, char **out_error) {
    NSError *error = nil;
    NSData *data = [[PTAudioRecorder shared] stopAndReadDataWithError:&error];
    if (data == nil) {
        if (out_error != NULL) {
            *out_error = pt_audio_strdup_ns(error.localizedDescription);
        }
        return NO;
    }
    NSString *base64 = [data base64EncodedStringWithOptions:0];
    if (out_base64 != NULL) {
        *out_base64 = pt_audio_strdup_ns(base64);
    }
    if (out_mime != NULL) {
        // AAC inside an MP4 container is what AVAudioRecorder writes when
        // AVFormatIDKey == kAudioFormatMPEG4AAC; OpenAI Whisper accepts this.
        *out_mime = pt_audio_strdup_ns(@"audio/mp4");
    }
    return YES;
}

__attribute__((visibility("default")))
BOOL pt_audio_play_base64(const char *base64, const char *mime, char **out_error) {
    if (base64 == NULL) {
        if (out_error != NULL) {
            *out_error = strdup("null base64 pointer");
        }
        return NO;
    }
    (void)mime; // AVAudioPlayer sniffs container/codec from data.

    NSString *encoded = [NSString stringWithUTF8String:base64];
    NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded
                                                       options:NSDataBase64DecodingIgnoreUnknownCharacters];
    if (data == nil) {
        if (out_error != NULL) {
            *out_error = strdup("invalid base64");
        }
        return NO;
    }
    NSError *error = nil;
    BOOL ok = [[PTAudioPlayer shared] playData:data error:&error];
    if (!ok && out_error != NULL) {
        *out_error = pt_audio_strdup_ns(error.localizedDescription);
    }
    return ok;
}

__attribute__((visibility("default")))
void pt_audio_stop_playback(void) {
    [[PTAudioPlayer shared] stop];
}

__attribute__((visibility("default")))
void pt_audio_string_free(char *s) {
    if (s != NULL) {
        free(s);
    }
}
